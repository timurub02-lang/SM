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
export async function sessionEmployee(h:Headers):Promise<Employee|null>{
 const token=cookieToken(h);if(!/^[a-f0-9]{64}$/.test(token))return null;
 await ensureAuth();
 const row=await db().prepare('SELECT e.data,e.version FROM auth_sessions s JOIN auth_accounts a ON a.employee_id=s.employee_id JOIN employees e ON e.id=s.employee_id WHERE s.token_hash=? AND s.expires_at>? AND a.enabled=1').bind(tokenHash(token),Date.now()).first<{data:string;version:number}>();
 return row?{...JSON.parse(row.data),version:row.version}:null;
}
export function trustedOrigin(h:Headers){return h.get('origin')===process.env.CRM_ORIGIN&&h.get('sec-fetch-site')!=='cross-site';}
export async function login(login:string,password:string,ip:string){
 await ensureAuth();const now=Date.now(),cutoff=now-15*60*1000;
 await db().prepare('DELETE FROM auth_attempts WHERE started_at<?').bind(cutoff).run();
 for(const [key,limit] of [[tokenHash('login:'+login),10],[tokenHash('ip:'+ip),80]] as const){
  await db().prepare('INSERT INTO auth_attempts(key,started_at,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').bind(key,now).run();
  const r=await db().prepare('SELECT attempts FROM auth_attempts WHERE key=?').bind(key).first<{attempts:number}>();
  if(r!.attempts>limit)return {limited:true} as const;
 }
 const row=await db().prepare("SELECT a.employee_id,a.password_hash,a.enabled FROM auth_accounts a JOIN employees e ON e.id=a.employee_id WHERE lower(trim(json_extract(e.data,'$.login')))=?").bind(login).first<{employee_id:string;password_hash:string;enabled:number}>();
 // Run the password KDF even for an unknown login.
 const valid=await verifyPassword(password,row?.password_hash||'scrypt:00000000000000000000000000000000:'+ '00'.repeat(64));
 if(!row||!row.enabled||!valid)return null;
 const token=newToken();const results=await db().batch([
  db().prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(now),
  db().prepare("INSERT INTO auth_sessions(token_hash,employee_id,expires_at) SELECT ?,a.employee_id,? FROM auth_accounts a JOIN employees e ON e.id=a.employee_id WHERE a.employee_id=? AND a.password_hash=? AND a.enabled=1 AND lower(trim(json_extract(e.data,'$.login')))=?").bind(tokenHash(token),now+sessionLifetime*1000,row.employee_id,row.password_hash,login),
  db().prepare('DELETE FROM auth_attempts WHERE key=?').bind(tokenHash('login:'+login)),
 ]);
 return results[1].meta.changes?{token}:null;
}
