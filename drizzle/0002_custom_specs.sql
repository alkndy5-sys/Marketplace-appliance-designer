CREATE TABLE custom_specs (owner_id TEXT NOT NULL,id TEXT NOT NULL,ar_key TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner_id,id),UNIQUE(owner_id,ar_key));
