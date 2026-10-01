export const authSchema=[
'CREATE TABLE IF NOT EXISTS auth_accounts(employee_id TEXT PRIMARY KEY REFERENCES employees(id),password_hash TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1)',
'CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),expires_at INTEGER NOT NULL)',
'CREATE TABLE IF NOT EXISTS auth_attempts(key TEXT PRIMARY KEY,started_at INTEGER NOT NULL,attempts INTEGER NOT NULL)',
"CREATE UNIQUE INDEX IF NOT EXISTS employee_login_unique ON employees(lower(trim(json_extract(data,'$.login'))))"
];
