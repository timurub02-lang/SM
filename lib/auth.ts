import {authSchema} from './auth-schema';
import {db} from './db';
import {newToken,tokenHash,verifyPassword} from './auth-crypto';
import type {Employee} from './crm';
export const sessionCookie='__Host-sm-session';
export const sessionLifetime=12*60*60;
export const personalAuth=()=>process.env.CRM_RUNTIME==='miran';
let ready:Promise<unknown>|undefined;
export function ensureAuth(){return ready??=db().batch([
 ...authSchema.map(sql=>db().prepare(sql)),
]).catch(error=>{ready=undefined;throw error;});}
export function cookieToken(h:Headers){return (h.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(sessionCookie+'='))?.slice(sessionCookie.length+1)||'';}
export async function sessionOwner(h:Headers,allowTestAccount=false){
 const token=cookieToken(h);if(!/^[a-f0-9]{64}$/.test(token))return null;
 await ensureAuth();const hash=tokenHash(token);
 const row=await db().prepare('SELECT e.data,e.version,s.expires_at,t.employee_id AS test_id FROM auth_sessions s JOIN auth_accounts a ON a.employee_id=s.employee_id JOIN employees e ON e.id=s.employee_id LEFT JOIN auth_test_accounts t ON t.employee_id=e.id WHERE s.token_hash=? AND s.expires_at>? AND a.enabled=1').bind(hash,Date.now()).first<{data:string;version:number;expires_at:number;test_id:string|null}>();
 if(!row||(row.test_id&&!allowTestAccount))return null;
 return {employee:{...JSON.parse(row.data),version:row.version,testOnly:!!row.test_id} as Employee&{testOnly?:boolean},hash,expiresAt:row.expires_at};
}
export async function impersonationStatus(h:Headers){
 if(!personalAuth())return null;
 const owner=await sessionOwner(h);if(!owner)return null;
 const mode=await db().prepare('SELECT i.id,i.target_id,e.data FROM auth_impersonations i LEFT JOIN employees e ON e.id=i.target_id WHERE i.session_hash=?').bind(owner.hash).first<{id:string;target_id:string;data:string|null}>();
 return mode?{id:mode.id,name:mode.data?JSON.parse(mode.data).name:'Сотрудник',adminName:owner.employee.name}:null;
}
export async function sessionEmployee(h:Headers,allowTestAccount=false):Promise<(Employee&{testOnly?:boolean})|null>{
 const owner=await sessionOwner(h,allowTestAccount);if(!owner)return null;
 const mode=await db().prepare('SELECT id,target_id,expires_at FROM auth_impersonations WHERE session_hash=?').bind(owner.hash).first<{id:string;target_id:string;expires_at:number}>();
 if(!mode)return owner.employee;
 if(owner.employee.role!=='admin'||mode.expires_at<=Date.now())return null;
 const row=await db().prepare('SELECT e.data,e.version FROM employees e JOIN auth_accounts a ON a.employee_id=e.id LEFT JOIN auth_test_accounts t ON t.employee_id=e.id WHERE e.id=? AND a.enabled=1 AND t.employee_id IS NULL').bind(mode.target_id).first<{data:string;version:number}>();
 if(!row)return null;
 return {...JSON.parse(row.data),version:row.version,impersonation:{id:mode.id,adminId:owner.employee.id,adminName:owner.employee.name}};
}

export function trustedOrigin(h:Headers){
 const origin=h.get('origin'),allowed=[process.env.CRM_ORIGIN,...(process.env.CRM_ADDITIONAL_ORIGINS||'').split(',').map(x=>x.trim())];
 return !!origin&&origin!=='null'&&allowed.includes(origin)&&h.get('sec-fetch-site')!=='cross-site';
}
export async function login(login:string,password:string,ip:string){
 await ensureAuth();const now=Date.now(),cutoff=now-15*60*1000;
 await db().prepare('DELETE FROM auth_attempts WHERE started_at<?').bind(cutoff).run();
 for(const [key,limit] of [[tokenHash('login:'+login),10],[tokenHash('ip:'+ip),80]] as const){
  await db().prepare('INSERT INTO auth_attempts(key,started_at,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').bind(key,now).run();
  const r=await db().prepare('SELECT attempts FROM auth_attempts WHERE key=?').bind(key).first<{attempts:number}>();
  if(r!.attempts>limit)return {limited:true} as const;
 }
 const row=await db().prepare("SELECT a.employee_id,a.password_hash,a.enabled,t.employee_id AS test_id FROM auth_accounts a JOIN employees e ON e.id=a.employee_id LEFT JOIN auth_test_accounts t ON t.employee_id=e.id WHERE lower(trim(json_extract(e.data,'$.login')))=?").bind(login).first<{employee_id:string;password_hash:string;enabled:number;test_id:string|null}>();
 // Run the password KDF even for an unknown login.
 const valid=await verifyPassword(password,row?.password_hash||'scrypt:00000000000000000000000000000000:'+ '00'.repeat(64));
 if(!row||!row.enabled||!valid)return null;
 const token=newToken();const results=await db().batch([
  db().prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(now),
  db().prepare("INSERT INTO auth_sessions(token_hash,employee_id,expires_at) SELECT ?,a.employee_id,? FROM auth_accounts a JOIN employees e ON e.id=a.employee_id WHERE a.employee_id=? AND a.password_hash=? AND a.enabled=1 AND lower(trim(json_extract(e.data,'$.login')))=?").bind(tokenHash(token),now+sessionLifetime*1000,row.employee_id,row.password_hash,login),
  db().prepare('DELETE FROM auth_attempts WHERE key=?').bind(tokenHash('login:'+login)),
 ]);
 return results[1].meta.changes?{token,redirect:row.test_id?'/oktell-test':'/'}:null;
}
