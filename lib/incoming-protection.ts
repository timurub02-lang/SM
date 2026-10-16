import type {ActivityDb as Db} from './activity-store.ts';
import {normalizePhone,type Employee} from './crm.ts';
import {z} from 'zod';
export const protectionSchema=z.object({repeatLimit:z.number().int().min(3).max(100),burstLimit:z.number().int().min(5).max(500),challengeMinutes:z.number().int().min(1).max(60)});
export const protectionDefaults={repeatLimit:5,burstLimit:20,challengeMinutes:10};
export async function initProtection(d:Db){
 await d.batch([
  d.prepare("CREATE TABLE IF NOT EXISTS incoming_attempts(id TEXT PRIMARY KEY,phone TEXT NOT NULL,at TEXT NOT NULL,known INTEGER NOT NULL,decision TEXT NOT NULL DEFAULT 'allow',request_id TEXT,applied INTEGER NOT NULL DEFAULT 0)"),
  d.prepare('CREATE INDEX IF NOT EXISTS incoming_attempts_time ON incoming_attempts(at)'),
  d.prepare('CREATE INDEX IF NOT EXISTS incoming_attempts_phone ON incoming_attempts(phone,at)'),
  d.prepare("CREATE TABLE IF NOT EXISTS incoming_phone_policy(phone TEXT PRIMARY KEY,policy TEXT NOT NULL,actor TEXT NOT NULL,at TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS incoming_protection_state(id INTEGER PRIMARY KEY,until_at TEXT NOT NULL DEFAULT '')"),
  d.prepare('INSERT OR IGNORE INTO incoming_protection_state(id) VALUES(1)'),
  d.prepare("CREATE TABLE IF NOT EXISTS incoming_protection_audit(id INTEGER PRIMARY KEY,at TEXT NOT NULL,actor TEXT NOT NULL,operation TEXT NOT NULL,target TEXT NOT NULL)")
 ]);
}
export async function protectionConfig(d:Db){
 const row=await d.prepare("SELECT data FROM settings WHERE id='incoming-protection'").first();
 return protectionSchema.parse({...protectionDefaults,...JSON.parse(row?.data||'{}')});
}
export async function incomingGate(d:Db,p:{id:string;phone:string},now=new Date()){
 await initProtection(d);
 const existing=await d.prepare('SELECT decision FROM incoming_attempts WHERE id=?').bind(p.id).first();
 if(existing)return existing.decision as string;
 const phone=normalizePhone(p.phone),at=now.toISOString(),cfg=await protectionConfig(d);
 const known=phone?await d.prepare("SELECT id FROM clients WHERE phone=? OR phone=? OR EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(data,'$.linkedPhones'),'[]')) WHERE value=? OR value=?) LIMIT 1").bind(phone,phone.slice(1),phone,phone.slice(1)).first():null;
 const minute=new Date(now.getTime()-60000).toISOString(),five=new Date(now.getTime()-300000).toISOString(),until=new Date(now.getTime()+cfg.challengeMinutes*60000).toISOString();
 await d.batch([
  d.prepare('INSERT OR IGNORE INTO incoming_attempts(id,phone,at,known) VALUES(?,?,?,?)').bind(p.id,phone,at,known?1:0),
  d.prepare("UPDATE incoming_protection_state SET until_at=? WHERE id=1 AND (SELECT COUNT(DISTINCT phone) FROM incoming_attempts WHERE at>=? AND known=0 AND phone<>'' AND phone NOT IN (SELECT phone FROM incoming_phone_policy WHERE policy='allow'))>=?").bind(until,minute,cfg.burstLimit),
  d.prepare("UPDATE incoming_attempts SET decision=CASE WHEN phone IN (SELECT phone FROM incoming_phone_policy WHERE policy='block') THEN 'block' WHEN phone IN (SELECT phone FROM incoming_phone_policy WHERE policy='allow') THEN 'allow' WHEN known=0 AND (phone='' OR (SELECT until_at FROM incoming_protection_state WHERE id=1)>? OR (SELECT COUNT(*) FROM incoming_attempts a WHERE a.phone=incoming_attempts.phone AND a.at>=?)>=?) THEN 'challenge' ELSE 'allow' END WHERE id=? AND applied=0").bind(at,five,cfg.repeatLimit,p.id)
 ]);
 return (await d.prepare('SELECT decision FROM incoming_attempts WHERE id=?').bind(p.id).first())!.decision as string;
}
export async function moderateIncoming(d:Db,e:Employee,p:{id:string;operation:'restore'|'block'|'unblock'|'spam'}){
 if(e.role!=='admin')throw Error('Управление защитой доступно администратору');
 const row=await d.prepare('SELECT * FROM incoming_calls WHERE id=?').bind(p.id).first();
 if(!row)throw Error('Обращение не найдено');
 const at=new Date().toISOString(),policy=p.operation==='block'?'block':p.operation==='restore'?'allow':null;
 const statements=[];
 if(policy){if(!row.phone)throw Error('Номер не определён');statements.push(d.prepare('INSERT INTO incoming_phone_policy(phone,policy,actor,at) VALUES(?,?,?,?) ON CONFLICT(phone) DO UPDATE SET policy=excluded.policy,actor=excluded.actor,at=excluded.at').bind(row.phone,policy,e.id,at));}
 if(p.operation==='unblock')statements.push(d.prepare('DELETE FROM incoming_phone_policy WHERE phone=?').bind(row.phone));
 if(p.operation==='restore')statements.push(d.prepare("UPDATE incoming_calls SET spam=0,spam_reason='' WHERE phone=? AND closed_at IS NULL").bind(row.phone));
 if(p.operation==='spam'||p.operation==='block')statements.push(d.prepare("UPDATE incoming_calls SET spam=1,spam_reason=? WHERE id=? OR (phone<>'' AND phone=? AND closed_at IS NULL)").bind(p.operation==='block'?'Номер заблокирован администратором':'Отмечено администратором',p.id,row.phone));
 statements.push(d.prepare('INSERT INTO incoming_protection_audit(at,actor,operation,target) VALUES(?,?,?,?)').bind(at,e.id,p.operation,p.id));
 await d.batch(statements);
}
