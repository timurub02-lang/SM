import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
if(!process.env.CRM_DATABASE_PATH)throw Error('CRM_DATABASE_PATH required');
const db=new DatabaseSync(process.env.CRM_DATABASE_PATH);
try{
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 for(const sql of authSchema)db.exec(sql);
 if(process.argv.includes('--bootstrap-admin')){
  const row=db.prepare("SELECT id,data FROM employees WHERE id='admin'").get();
  if(!row||JSON.parse(row.data).role!=='admin')throw Error('Expected existing administrator');
  if(db.prepare('SELECT employee_id FROM auth_accounts WHERE employee_id=?').get(row.id))throw Error('Administrator already configured; refusing to replace password');
  const password=readFileSync(0,'utf8').replace(/\r?\n$/,'');
  db.prepare('INSERT INTO auth_accounts(employee_id,password_hash,enabled) VALUES(?,?,1)').run(row.id,await hashPassword(password));
  console.log('Administrator login: '+JSON.parse(row.data).login);
 }
 console.log('Authentication schema ready');
}finally{db.close();}
