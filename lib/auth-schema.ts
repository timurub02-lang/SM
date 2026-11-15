export const authSchema=[
'CREATE TABLE IF NOT EXISTS auth_impersonations(session_hash TEXT PRIMARY KEY,id TEXT NOT NULL UNIQUE,target_id TEXT NOT NULL,started_at INTEGER NOT NULL,expires_at INTEGER NOT NULL)',
'CREATE TABLE IF NOT EXISTS auth_impersonation_audit(id TEXT PRIMARY KEY,impersonation_id TEXT NOT NULL,admin_id TEXT NOT NULL,target_id TEXT NOT NULL,at INTEGER NOT NULL,kind TEXT NOT NULL,method TEXT,path TEXT,action TEXT,entity_id TEXT,status INTEGER)',

 `CREATE TABLE IF NOT EXISTS auth_test_accounts(employee_id TEXT PRIMARY KEY NOT NULL)`,
'CREATE TABLE IF NOT EXISTS auth_accounts(employee_id TEXT PRIMARY KEY REFERENCES employees(id),password_hash TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1)',
'CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),expires_at INTEGER NOT NULL)',
'CREATE TABLE IF NOT EXISTS auth_attempts(key TEXT PRIMARY KEY,started_at INTEGER NOT NULL,attempts INTEGER NOT NULL)',
"CREATE UNIQUE INDEX IF NOT EXISTS employee_login_unique ON employees(lower(trim(json_extract(data,'$.login'))))"
];
