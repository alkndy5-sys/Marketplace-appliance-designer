const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n));
export function matchesModel(text,model){const chars=model.toLowerCase().replace(/[^a-z0-9]/g,'').split('');if(!chars.length)return false;return new RegExp('(^|[^a-z0-9])'+chars.join('[\\s_./-]*')+'(?![a-z0-9])','i').test(text);}
export function parseResults(html,model,brand=''){
 const out=[],seen=new Set();for(const m of html.matchAll(/\bm="([^"]+)"/g)){try{const x=JSON.parse(decode(m[1]));if(!x.murl||!x.purl)continue;const title=String(x.t||x.desc||'');if(!matchesModel(title+' '+decodeURIComponent(x.purl),model))continue;
 const page=publicURL(x.purl),image=publicURL(x.murl);if(brand&&/[a-z]/i.test(brand)&&!['brand','unknown'].includes(brand.toLowerCase())&&!(title+' '+page.hostname+' '+image.hostname).toLowerCase().includes(brand.toLowerCase()))continue;
 if(seen.has(image.href))continue;seen.add(image.href);out.push({url:image.href,page:page.href,title,source:page.hostname});if(out.length===12)break;}catch{}}
 return out;
}
function publicURL(raw){const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')throw Error('رابط غير صالح');const h=u.hostname.toLowerCase();if(!h.includes('.')||/^[\d.]+$/.test(h)||h.includes(':')||/(^|\.)(localhost|local|internal|test|invalid)$/.test(h))throw Error('رابط غير صالح');return u;}
async function signature(value){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(SIGNING_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
async function ticket(url){const value=btoa(JSON.stringify({url,exp:Date.now()+15*60*1000}));return '/api/product-image?t='+encodeURIComponent(value)+'&s='+await signature(value);}
async function loadImage(raw){let u=publicURL(raw);for(let n=0;n<4;n++){const r=await fetch(u.href,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0','Accept':'image/avif,image/webp,image/png,image/jpeg'},signal:AbortSignal.timeout(10000)});if(r.status>=300&&r.status<400){u=publicURL(new URL(r.headers.get('Location'),u).href);continue;}if(!r.ok||!/^image\/(jpeg|png|webp|avif|gif)/i.test(r.headers.get('Content-Type')||''))throw Error('تعذر تحميل ملف صورة صالح');const length=Number(r.headers.get('Content-Length')||0);if(length>12*1024*1024)throw Error('حجم الصورة كبير');const reader=r.body.getReader();const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>12*1024*1024){await reader.cancel();throw Error('حجم الصورة كبير');}chunks.push(value);}return new Response(new Blob(chunks),{headers:{'Content-Type':r.headers.get('Content-Type'),'Cache-Control':'private, max-age=600','X-Content-Type-Options':'nosniff'}});}throw Error('تعذر تحميل الصورة');}

const stripHTML=s=>decode(String(s||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
export function parseProductPage(html,url,model){
    const tags=[...html.matchAll(/<meta\b[^>]*>/gi)].map(m=>m[0]);
    const attr=(tag,name)=>{const m=tag.match(new RegExp('\\b'+name+'\\s*=\\s*(["\\\'])([\\s\\S]*?)\\1','i'));return m?decode(m[2]):'';};
    const meta=name=>{for(const tag of tags)if(attr(tag,'property').toLowerCase()===name||attr(tag,'name').toLowerCase()===name)return attr(tag,'content');return '';};
    const title=stripHTML(meta('og:title')||html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');
    const nodes=[];const walk=v=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object'){const type=v['@type'];if((Array.isArray(type)?type:[type]).some(x=>x==='Product'||x==='ProductModel'))nodes.push(v);if(v['@graph'])walk(v['@graph']);if(v.mainEntity)walk(v.mainEntity);}};
    for(const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walk(JSON.parse(m[1]));}catch{}}
    const product=nodes.find(p=>matchesModel([p.name,p.sku,p.mpn,p.model].filter(x=>typeof x==='string').join(' '),model));
    if(!product&&!matchesModel(title,model)&&!matchesModel(decodeURIComponent(url),model))throw Error('صفحة المصدر لا تطابق رقم الموديل');
    const descriptions=[];if(product){descriptions.push(product.name,product.description);for(const p of (Array.isArray(product.additionalProperty)?product.additionalProperty:product.additionalProperty?[product.additionalProperty]:[])){if(p&&typeof p==='object')descriptions.push([p.name,p.value,p.unitText].filter(x=>typeof x==='string'||typeof x==='number').join(' '));}}
    descriptions.push(meta('description'),meta('og:description'));
    let images=product?.image||[];if(!Array.isArray(images))images=[images];images=images.map(x=>typeof x==='string'?x:x?.url||x?.contentUrl).filter(Boolean);images.push(meta('og:image'),meta('twitter:image'));
    return {title:stripHTML(product?.name||title),description:descriptions.map(stripHTML).filter(Boolean).join(' | ').slice(0,14000),images:[...new Set(images.filter(Boolean).map(raw=>new URL(raw,url).href))].slice(0,6),source:url,verified:true};
}
async function readProductSource(raw,model){
    let url=publicURL(raw);
    for(let redirects=0;redirects<4;redirects++){
        const r=await fetch(url.href,{redirect:'manual',signal:AbortSignal.timeout(14000),headers:{'User-Agent':'ProductCatalog/1.0','Accept':'text/html,application/xhtml+xml,image/*'}});
        if(r.status>=300&&r.status<400){url=publicURL(new URL(r.headers.get('Location'),url).href);continue;}
        if(!r.ok)throw Error('صفحة المنتج غير متاحة ('+r.status+')');
        const type=r.headers.get('Content-Type')||'';
        if(/^image\/(jpeg|png|webp|avif|gif)/i.test(type))return {title:model,description:'',images:[url.href],source:url.href,verified:false,directImage:true};
        if(!/text\/html|application\/xhtml/i.test(type))throw Error('الرابط ليس صفحة منتج أو صورة');
        const reader=r.body.getReader(),chunks=[];let size=0;while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2000000){await reader.cancel();throw Error('صفحة المنتج كبيرة جدًا');}chunks.push(value);}
        return parseProductPage(await new Blob(chunks).text(),url.href,model);
    }throw Error('تعذّر فتح صفحة المنتج');
}


const utf8=new TextEncoder();
const encode64=bytes=>btoa(String.fromCharCode(...bytes));
const decode64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
async function searchWrappingKey(env){const value=String(env?.SEARCH_KEY_ENCRYPTION_KEY||'');if(!value)throw Error('التخزين المحمي للمفتاح غير متاح مؤقتًا');const bytes=decode64(value);if(bytes.length!==32)throw Error('تعذّر تهيئة التخزين المحمي');return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);}
export async function sealSearchKey(value,account,env){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:utf8.encode(account)},await searchWrappingKey(env),utf8.encode(value));return 'v1.'+encode64(iv)+'.'+encode64(new Uint8Array(encrypted));}
export async function openSearchKey(value,account,env){try{const [version,iv,data]=String(value).split('.');if(version!=='v1')throw Error('Version');const decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode64(iv),additionalData:utf8.encode(account)},await searchWrappingKey(env),decode64(data));return new TextDecoder().decode(decoded);}catch{throw Error('تعذر فتح مفتاح البحث المحفوظ؛ أعد حفظ المفتاح من إعدادات البحث');}}
async function storedSearchRecord(request,env){const account=request.headers.get('oai-authenticated-user-id');if(!account||!env?.DB)return null;return env.DB.prepare('SELECT encrypted_key, last_four, updated_at FROM user_search_settings WHERE owner_id = ?').bind(account).first();}
async function resolveSearchKey(request,env,body={}){const row=await storedSearchRecord(request,env);if(row?.encrypted_key)return openSearchKey(row.encrypted_key,request.headers.get('oai-authenticated-user-id'),env);return String(env?.SERPER_API_KEY||body.searchKey||'').trim();}

export default {async fetch(request,env,ctx){const u=new URL(request.url);try{
 if(u.pathname==='/assets/xlsx.full.min.js')return new Response(XLSX_LIBRARY,{headers:{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=86400'}});
 if(u.pathname==='/api/product-image'){const value=u.searchParams.get('t')||'',sig=u.searchParams.get('s')||'';if(value.length>6000||sig!==await signature(value))return json({error:'انتهى رابط الصورة؛ أعد البحث'},403);const data=JSON.parse(atob(value));if(data.exp<Date.now())return json({error:'انتهى رابط الصورة؛ أعد البحث'},403);return await loadImage(data.url);}



 if(u.pathname==='/api/custom-specs'||u.pathname==='/api/translate-spec'){
 const account=request.headers.get('oai-authenticated-user-id');if(!account)return json({error:'سجّل الدخول لحفظ مواصفاتك'},401);
 if(u.pathname==='/api/custom-specs'&&request.method==='GET'){if(!env?.DB)return json({error:'التخزين غير متاح'},503);const rows=await env.DB.prepare('SELECT payload FROM custom_specs WHERE owner_id=? ORDER BY created_at,id').bind(account).all();return json({specs:(rows.results||[]).map(r=>JSON.parse(r.payload))});}
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(request.headers.get('Origin')!==u.origin)return json({error:'Forbidden'},403);
 if(Number(request.headers.get('Content-Length')||0)>4096)return json({error:'النص طويل جدًا'},413);
 const body=await request.json();
 if(u.pathname==='/api/translate-spec'){
 const text=String(body.text||'').trim();if(!text||text.length>120||utf8.encode(text).length>450)return json({error:'أدخل وصفًا مختصرًا لا يتجاوز 120 حرفًا'},400);
 const direction=body.direction==='en-ar'?'en|ar':'ar|en';const url=new URL('https://api.mymemory.translated.net/get');url.searchParams.set('q',text);url.searchParams.set('langpair',direction);
 try{const r=await fetch(url,{signal:AbortSignal.timeout(12000)});const data=await r.json();const translated=stripHTML(data.responseData?.translatedText||'');if(!r.ok||Number(data.responseStatus)!==200||!translated||translated.length>200)throw Error('Translation unavailable');return json({translation:translated});}catch{
 try{const alternative=new URL('https://translate.googleapis.com/translate_a/single');alternative.searchParams.set('client','gtx');alternative.searchParams.set('sl',direction==='en|ar'?'en':'ar');alternative.searchParams.set('tl',direction==='en|ar'?'ar':'en');alternative.searchParams.set('dt','t');alternative.searchParams.set('q',text);const r=await fetch(alternative,{signal:AbortSignal.timeout(10000)});const data=await r.json();const translation=stripHTML(Array.isArray(data[0])?data[0].map(x=>typeof x?.[0]==='string'?x[0]:'').join(''):'');if(!r.ok||!translation||translation.length>200)throw Error('Unavailable');return json({translation});}catch{return json({error:'تعذّرت الترجمة الآن؛ يمكنك إعادة المحاولة أو إدخال الترجمة يدويًا'},502);}
 }
 }
 if(!env?.DB)return json({error:'التخزين غير متاح'},503);
 const ar=String(body.ar||'').trim(),en=String(body.en||'').trim(),glyph=String(body.glyph||'').trim();
 if(!ar||!en||ar.length>120||en.length>200||glyph.length>64||/[<>\x00-\x1f]/.test(glyph))return json({error:'أدخل المواصفة بالعربية والإنجليزية ورمزًا مختصرًا صالحًا'},400);
 const key=ar.normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
 const existing=await env.DB.prepare('SELECT payload FROM custom_specs WHERE owner_id=? AND ar_key=?').bind(account,key).first();
 const spec={id:existing?JSON.parse(existing.payload).id:'user_'+crypto.randomUUID(),ar,en,glyph:glyph||en.slice(0,2).toUpperCase(),families:[],keywords:[ar,en],custom:true};spec.icon='spec:'+spec.id;
 await env.DB.prepare('INSERT INTO custom_specs (owner_id,id,ar_key,payload,created_at) VALUES (?,?,?,?,?) ON CONFLICT(owner_id,ar_key) DO UPDATE SET payload=excluded.payload').bind(account,spec.id,key,JSON.stringify(spec),Date.now()).run();
 const saved=await env.DB.prepare('SELECT payload FROM custom_specs WHERE owner_id=? AND ar_key=?').bind(account,key).first();return json({spec:JSON.parse(saved.payload),saved:true});
 }

 if(u.pathname==='/api/search-settings'){
    const account=request.headers.get('oai-authenticated-user-id');if(!account)return json({error:'سجّل الدخول لحفظ المفتاح واستخدامه من أي جهاز'},401);
    if(!env?.DB)return json({error:'خدمة حفظ المفتاح غير متاحة مؤقتًا'},503);
    if(request.method==='GET'){const row=await storedSearchRecord(request,env);return json({configured:!!row?.encrypted_key||!!env?.SERPER_API_KEY,lastFour:row?.last_four||'',updatedAt:row?.updated_at||null});}
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    if(request.headers.get('Origin')!==u.origin)return json({error:'Forbidden'},403);
    if(Number(request.headers.get('Content-Length')||0)>4096)return json({error:'طلب غير صالح'},413);
    const body=await request.json();const value=String(body.apiKey||'').trim();
    if(!/^[a-zA-Z0-9_-]{16,200}$/.test(value))return json({error:'أدخل مفتاح Serper الصحيح ثم اضغط حفظ'},400);
    const encrypted=await sealSearchKey(value,account,env),updated=Date.now(),lastFour=value.slice(-4);
    await env.DB.prepare('INSERT INTO user_search_settings (owner_id,encrypted_key,last_four,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET encrypted_key=excluded.encrypted_key,last_four=excluded.last_four,updated_at=excluded.updated_at').bind(account,encrypted,lastFour,updated).run();
    return json({configured:true,lastFour,updatedAt:updated});
 }

 if(u.pathname==='/api/brands'){
    const account=request.headers.get('oai-authenticated-user-id');
    if(!account)return json({error:'سجّل الدخول بحسابك لحفظ الماركات واستعراضها من أي جهاز'},401);
    if(!env.DB)return json({error:'التخزين الدائم غير متاح مؤقتًا'},503);
    if(request.method==='GET'){
        const rows=await env.DB.prepare('SELECT payload FROM brand_library WHERE owner_id = ? ORDER BY updated_at DESC, brand_id').bind(account).all();
        const brands=(rows.results||[]).map(row=>JSON.parse(row.payload));
        return json({account,brands});
    }
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    if(request.headers.get('Origin')!==u.origin)return json({error:'Forbidden'},403);
    const body=await request.json();const upsert=body.upsert||[],deleted=body.deleted||[];
    if(!Array.isArray(upsert)||!Array.isArray(deleted)||upsert.length>250||deleted.length>500)return json({error:'عدد الماركات في الطلب كبير؛ قسّمه إلى مجموعات أصغر'},400);
    const statements=[];
    for(const raw of upsert){
        if(typeof raw.id!=='string'||raw.id.length>160||!raw.id||typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>150)return json({error:'بيانات الماركة غير صالحة'},400);
        const logo=String(raw.logoUrl||'');if(logo.length>1500000)return json({error:'شعار الماركة كبير؛ استخدم صورة أصغر من 1 ميجابايت'},400);
        if(logo&&!/^https:\/\//i.test(logo)&&!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(logo))return json({error:'رابط الشعار يجب أن يكون HTTPS أو صورة PNG/JPG/WebP'},400);
        const brand={id:raw.id,name:raw.name.trim(),mode:raw.mode==='img'?'img':'text',logoUrl:logo};
        statements.push(env.DB.prepare('INSERT INTO brand_library (owner_id,brand_id,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,brand_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').bind(account,brand.id,JSON.stringify(brand),Date.now()));
    }
    for(const id of deleted){if(typeof id!=='string'||id.length>160)return json({error:'معرف ماركة غير صالح'},400);statements.push(env.DB.prepare('DELETE FROM brand_library WHERE owner_id=? AND brand_id=?').bind(account,id));}
    if(statements.length)await env.DB.batch(statements);
    return json({saved:true});
 }


 if(u.pathname==='/api/product-info'||u.pathname==='/api/product-enrich'){
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    if(request.headers.get('Origin')!==u.origin)return json({error:'Forbidden'},403);
    const body=await request.json(),model=String(body.model||'').trim();
    if(model.length>80||!(/^[0-9]+$/.test(model)||(model.length>=3&&/^[a-z0-9\s./_-]+$/i.test(model))))return json({error:'يلزم رقم موديل صحيح لقراءة المصدر'},400);
    if(u.pathname==='/api/product-info'){
        const product=await readProductSource(String(body.url||''),model);
        const images=[];for(const raw of product.images){try{images.push({image:await ticket(publicURL(raw).href),page:product.source,title:product.title,source:new URL(product.source).hostname});}catch{}}
        return json({...product,images});
    }
    const key=await resolveSearchKey(request,env,body);if(!key)return json({error:'يحتاج البحث عن وصف الويب إلى مفتاح بحث أو رابط صفحة المنتج في الإكسل',code:'SEARCH_KEY_REQUIRED'},503);
    const r=await fetch('https://google.serper.dev/search',{method:'POST',headers:{'X-API-KEY':key,'Content-Type':'application/json'},body:JSON.stringify({q:'"'+model+'" '+String(body.brand||'').slice(0,60)+' specifications',num:5}),signal:AbortSignal.timeout(15000)});
    if(!r.ok)return json({error:'خدمة البحث عن المواصفات غير متاحة'},502);const found=await r.json();
    for(const hit of (found.organic||[]).slice(0,4)){if(!matchesModel(String(hit.title||'')+' '+String(hit.link||''),model))continue;try{const product=await readProductSource(hit.link,model);if(!product.verified)continue;const images=[];for(const raw of product.images){try{images.push({image:await ticket(publicURL(raw).href),page:product.source,title:product.title,source:new URL(product.source).hostname});}catch{}}return json({...product,images});}catch{}}
    return json({error:'لم نعثر على وصف موثوق مطابق للموديل'},404);
 }

 if(u.pathname.startsWith('/api/')){
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(request.headers.get('Origin')!==u.origin)return json({error:'Forbidden'},403);
 if(Number(request.headers.get('Content-Length')||0)>8000)return json({error:'طلب كبير'},413);
 const body=await request.json();
 if(u.pathname==='/api/product-images/prepare')return json({image:await ticket(publicURL(String(body.url||'')).href)});
 if(u.pathname!=='/api/product-images')return json({error:'Not found'},404);
 const model=String(body.model||'').trim(),brand=String(body.brand||'').trim().slice(0,60);
 if(model.length>80||!(/^[0-9]+$/.test(model)||(model.length>=3&&/[a-z]/i.test(model)&&/[0-9]/.test(model)&&/^[a-z0-9\s./_-]+$/i.test(model))))return json({error:'أدخل رقم الموديل، مثل 800102043 أو HD9252/90'},400);

 const key=await resolveSearchKey(request,env,body);
 if(!key)return json({error:'لتفعيل جلب الصور من الويب، أضف مفتاح Serper في إعداد البحث أدناه. يمكنك أيضًا لصق رابط صورة الشركة المصنعة.',code:'SEARCH_KEY_REQUIRED'},503);
 if(key.length<16||key.length>200)return json({error:'مفتاح خدمة البحث غير صالح'},400);
 const upstream=await fetch('https://google.serper.dev/images',{method:'POST',headers:{'X-API-KEY':key,'Content-Type':'application/json'},body:JSON.stringify({q:'"'+model+'" '+brand+' product white background',num:10}),signal:AbortSignal.timeout(15000)});
 if(!upstream.ok){
 const failure=await upstream.json().catch(()=>({}));
 const detail=String(failure.message||failure.error?.message||failure.error||'').replaceAll(key,'[hidden]').slice(0,240);
 const quota=upstream.status===429||/credit|balance|quota|insufficient/i.test(detail);
 const invalid=upstream.status===401||upstream.status===403||/invalid.*key|unauthorized|api.key.*invalid/i.test(detail);
 console.error('image-search-provider-status',upstream.status,quota?'quota':invalid?'key':'request');
 return json({code:quota?'SEARCH_QUOTA_LIMIT':invalid?'SEARCH_KEY_INVALID':'SEARCH_PROVIDER_ERROR',error:quota?'رصيد Serper غير كافٍ أو تم بلوغ حد الطلبات؛ تحقق من رصيد حسابك في Serper':invalid?'رفضت Serper مفتاح البحث؛ استبدله بمفتاح API صالح من حسابك في Serper':'رفضت خدمة البحث الطلب (HTTP '+upstream.status+')'+(detail?' — '+detail:'')},502);
 }
 const payload=await upstream.json();
 // Reuse identical source/model/URL validation for the provider's actual results.
 const metadata=(payload.images||[]).map(x=>'m="'+JSON.stringify({murl:x.imageUrl,purl:x.link,t:x.title}).replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"').join(' ');
 const results=parseResults(metadata,model,brand);
 const images=await Promise.all(results.map(async x=>({...x,image:await ticket(x.url),url:undefined})));
 return json({model,images});
 }
 return new Response(APP_HTML,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'}});
 }catch(error){console.error('product-image-failure',error.message);return json({error:error.message||'تعذر البحث الآن'},502);}}};

