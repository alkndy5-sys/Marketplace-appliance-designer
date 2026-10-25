const fs=require('fs'),crypto=require('crypto');
const manifest=JSON.parse(fs.readFileSync('.openai/hosting.json','utf8'));delete manifest.static;fs.writeFileSync('.openai/hosting.json',JSON.stringify(manifest,null,2));
fs.mkdirSync('dist/server',{recursive:true});fs.mkdirSync('dist/.openai',{recursive:true});
const html=fs.readFileSync('app/index.html','utf8');
const backend=fs.readFileSync('worker/backend.js','utf8');
fs.writeFileSync('dist/server/index.js','const XLSX_LIBRARY='+JSON.stringify(fs.readFileSync('app/vendor/xlsx.full.min.js','utf8'))+';\nconst APP_HTML='+JSON.stringify(html)+';\nconst SIGNING_KEY='+JSON.stringify(crypto.randomBytes(32).toString('hex'))+';\n'+backend);
fs.writeFileSync('dist/.openai/hosting.json',JSON.stringify(manifest,null,2));
if(fs.existsSync('dist/index.html'))fs.unlinkSync('dist/index.html');
console.log('Built Worker and preserved site identity');
