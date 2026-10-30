import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {ActivityDb as Db} from './activity-store.ts';
import {distributionEligible,moscowDate,normalizedPhone} from './base-distribution.ts';
import {blockedSheets} from './base-policy.ts';
import {initBaseDispatch} from './base-dispatch.ts';
import {pilotControl} from './oktell-pilot-control.ts';
import phoneTime from './phone-timezone.cjs';

export const deliverySelection=z.object({taskId:z.string().uuid().transform(v=>v.toLowerCase()),base:z.enum(['M','J']),sheet:z.string().trim().min(1).max(60),count:z.number().int().min(1).max(1000)}).strict();
type Selection=z.infer<typeof deliverySelection>;
export async function initOktellDelivery(d:Db){
 await initBaseDispatch(d);
 await d.prepare(`CREATE TABLE IF NOT EXISTS oktell_deliveries(id TEXT PRIMARY KEY,actor TEXT NOT NULL,selection TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,error TEXT NOT NULL DEFAULT '')`).run();
 await d.prepare(`CREATE TABLE IF NOT EXISTS oktell_delivery_items(job_id TEXT NOT NULL REFERENCES oktell_deliveries(id),client_id TEXT NOT NULL,phone TEXT NOT NULL,client_version INTEGER NOT NULL,name TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'reserved',PRIMARY KEY(job_id,client_id))`).run();
 await d.prepare("CREATE UNIQUE INDEX IF NOT EXISTS oktell_delivery_client ON oktell_delivery_items(client_id) WHERE state IN ('reserved','delivered')").run();
 await d.prepare("CREATE UNIQUE INDEX IF NOT EXISTS oktell_delivery_phone ON oktell_delivery_items(phone) WHERE state IN ('reserved','delivered')").run();
 await d.prepare("CREATE UNIQUE INDEX IF NOT EXISTS oktell_delivery_live_client ON oktell_delivery_items(client_id) WHERE state IN ('reserved','delivered','handed_off')").run();
 await d.prepare("CREATE UNIQUE INDEX IF NOT EXISTS oktell_delivery_live_phone ON oktell_delivery_items(phone) WHERE state IN ('reserved','delivered','handed_off')").run();
 await d.prepare('CREATE TABLE IF NOT EXISTS oktell_delivery_calls(chain TEXT PRIMARY KEY,job_id TEXT NOT NULL,client_id TEXT NOT NULL,actor_id TEXT NOT NULL,phone TEXT NOT NULL)').run();
 await d.prepare("CREATE TRIGGER IF NOT EXISTS oktell_delivery_cancel_guard BEFORE UPDATE OF state ON oktell_deliveries WHEN NEW.state='cancelled' AND EXISTS(SELECT 1 FROM oktell_delivery_calls WHERE job_id=NEW.id) BEGIN SELECT RAISE(ABORT,'Oktell: delivery has call history; queue reconciliation required'); END").run();
 await d.prepare("CREATE TRIGGER IF NOT EXISTS oktell_handoff_delete_guard BEFORE DELETE ON clients WHEN EXISTS(SELECT 1 FROM oktell_delivery_items WHERE client_id=OLD.id AND state='handed_off') BEGIN SELECT RAISE(ABORT,'В Oktell ещё не завершена обработка клиента'); END").run();
 await d.prepare(`CREATE TRIGGER IF NOT EXISTS oktell_handoff_phone_guard BEFORE UPDATE OF data,phone ON clients WHEN EXISTS(SELECT 1 FROM oktell_delivery_items WHERE client_id=NEW.id AND state='handed_off') AND (COALESCE(NEW.phone,'')<>COALESCE(OLD.phone,'') OR COALESCE(json_extract(NEW.data,'$.phone'),'')<>COALESCE(json_extract(OLD.data,'$.phone'),'')) BEGIN SELECT RAISE(ABORT,'В Oktell ещё не завершена обработка номера'); END`).run();
 await d.prepare("CREATE TRIGGER IF NOT EXISTS oktell_delivery_delete_guard BEFORE DELETE ON clients WHEN EXISTS(SELECT 1 FROM oktell_delivery_items WHERE client_id=OLD.id AND state IN ('reserved','delivered')) BEGIN SELECT RAISE(ABORT,'Клиент загружен в Oktell. Сначала отмените загрузку'); END").run();
 // A delivered client remains reserved until the native call handoff, not just until HTTP acknowledges the import.
 await d.prepare(`CREATE TRIGGER IF NOT EXISTS oktell_delivery_assignment_guard BEFORE UPDATE OF data,phone ON clients WHEN EXISTS(SELECT 1 FROM oktell_delivery_items WHERE client_id=NEW.id AND state IN ('reserved','delivered')) AND (COALESCE(json_extract(NEW.data,'$.owner'),'')<>COALESCE(json_extract(OLD.data,'$.owner'),'') OR COALESCE(NEW.phone,'')<>COALESCE(OLD.phone,'') OR COALESCE(json_extract(NEW.data,'$.phone'),'')<>COALESCE(json_extract(OLD.data,'$.phone'),'') OR COALESCE(json_extract(NEW.data,'$.baseType'),'M')<>COALESCE(json_extract(OLD.data,'$.baseType'),'M') OR COALESCE(json_extract(NEW.data,'$.sheet'),'')<>COALESCE(json_extract(OLD.data,'$.sheet'),'')) BEGIN SELECT RAISE(ABORT,'Клиент загружен в Oktell. Сначала завершите или отмените его участие в проекте'); END`).run();
}
export async function previewOktellDelivery(d:Db,input:unknown,now=new Date()){
 const p=deliverySelection.parse(input);if(blockedSheets.includes(p.sheet as any))throw Error('Листы К, ЧС и ПВ не участвуют в обзвоне');
 await initOktellDelivery(d);
 const rows=(await d.prepare(`SELECT id,data,version FROM clients WHERE COALESCE(json_extract(data,'$.baseType'),'M')=? AND json_extract(data,'$.sheet')=? ORDER BY COALESCE(json_extract(data,'$.distributedAt'),''),id`).bind(p.base,p.sheet).all()).results;
 const reserved=new Set((await d.prepare("SELECT client_id FROM oktell_delivery_items WHERE state IN ('reserved','delivered','handed_off')").all()).results.map((r:any)=>r.client_id));
 const phones=new Set((await d.prepare("SELECT phone FROM oktell_delivery_items WHERE state IN ('reserved','delivered','handed_off')").all()).results.map((r:any)=>r.phone));
 const pendingSk=new Set((await d.prepare("SELECT client_id FROM base_dispatch_items WHERE state IN ('pending','sending','unknown')").all()).results.map((r:any)=>r.client_id));
 const activeOrders=new Set((await d.prepare("SELECT DISTINCT client_id FROM orders WHERE json_extract(data,'$.status') IN ('draft','confirm','rework','check','extra','packing','phone','shipping','pickup')").all()).results.map((r:any)=>r.client_id));
 const restrictedPhones=new Set<string>();
 for(const r of (await d.prepare("SELECT data FROM clients WHERE json_extract(data,'$.sheet') IN ('ЧС','ПВ','К') OR COALESCE(json_extract(data,'$.owner'),'')<>''").all()).results){const c=JSON.parse(r.data);for(const n of [c.phone,...(Array.isArray(c.linkedPhones)?c.linkedPhones:[])]){const phone=normalizedPhone(n);if(phone)restrictedPhones.add(phone);}}
 const today=moscowDate(now),skipped={assigned:0,cooling:0,invalid:0,reserved:0,duplicate:0,restrictedNumber:0,activeOrder:0};
 const items:{clientId:string;phone:string;name:string;version:number}[]=[];
 for(const row of rows){
  const c=JSON.parse(row.data),phone=normalizedPhone(c.phone);
  if(c.owner){skipped.assigned++;continue;}
  if(!distributionEligible(c,today)){skipped.cooling++;continue;}
  if(!phone){skipped.invalid++;continue;}
  if(activeOrders.has(row.id)){skipped.activeOrder++;continue;}
  if(restrictedPhones.has(phone)){skipped.restrictedNumber++;continue;}
  if(reserved.has(row.id)||pendingSk.has(row.id)){skipped.reserved++;continue;}
  if(phones.has(phone)){skipped.duplicate++;continue;}
  phones.add(phone);items.push({clientId:row.id,phone,name:String(c.name||phone).slice(0,100),version:row.version});
 }
 const selected=items.slice(0,p.count),fingerprint=createHash('sha256').update(JSON.stringify({selection:p,items:selected})).digest('hex');
 const timezones={resolved:0,multiple:0,unknown:0,invalid:0,stale:0};
 for(const item of selected){const status=phoneTime.resolvePhoneTimezone(item.phone,now).status as keyof typeof timezones;timezones[status]++;}
 return {selection:p,total:rows.length,eligible:items.length,selected:selected.length,skipped,fingerprint,items:selected,timezones,timezoneSource:'phone_number'};
}
export async function reserveOktellDelivery(d:Db,actor:string,id:string,input:unknown,fingerprint:string,now=new Date()){
 id=z.string().uuid().parse(id).toLowerCase();z.string().regex(/^[a-f0-9]{64}$/).parse(fingerprint);const selection=deliverySelection.parse(input);
 await initOktellDelivery(d);
 const old=await d.prepare('SELECT * FROM oktell_deliveries WHERE id=?').bind(id).first();
 if(old){if(old.actor!==actor||old.fingerprint!==fingerprint||old.selection!==JSON.stringify(selection))throw Error('Идентификатор загрузки уже использован');return {id,state:old.state,replayed:true};}
 const p=await previewOktellDelivery(d,selection,now);if(p.fingerprint!==fingerprint)throw Error('Состав базы изменился. Повторите проверку');if(!p.selected)throw Error('Нет доступных клиентов');
 const at=now.toISOString();
 const statements=[d.prepare("INSERT INTO oktell_deliveries(id,actor,selection,fingerprint,state,created_at,updated_at) VALUES(?,?,?,?,'reserved',?,?)").bind(id,actor,JSON.stringify(selection),fingerprint,at,at)];
 for(const item of p.items){
  // Abort the whole batch if even one card changed between preview and reservation.
  statements.push(d.prepare(`INSERT INTO oktell_delivery_items(job_id,client_id,phone,client_version,name) VALUES(?,(SELECT id FROM clients WHERE id=? AND version=? AND COALESCE(json_extract(data,'$.owner'),'')='' AND json_extract(data,'$.sheet')=?),?,?,?)`).bind(id,item.clientId,item.version,selection.sheet,item.phone,item.version,item.name));
 }
 await d.batch(statements);return {id,state:'reserved',replayed:false};
}

export async function sendOktellDelivery(d:Db,id:string,request:typeof pilotControl=pilotControl){
 id=z.string().uuid().parse(id).toLowerCase();await initOktellDelivery(d);
 const job=await d.prepare('SELECT * FROM oktell_deliveries WHERE id=?').bind(id).first();if(!job)throw Error('Загрузка не найдена');
 if(['delivered','cancelled','completed'].includes(job.state))return {id,state:job.state};
 const rows=(await d.prepare('SELECT client_id,phone,name FROM oktell_delivery_items WHERE job_id=? ORDER BY client_id').bind(id).all()).results;
 const items=rows.map((r:any)=>({clientId:r.client_id,phone:r.phone,name:r.name}));
 try{
  const receipt=z.object({id:z.string().uuid(),taskId:z.string().uuid(),fingerprint:z.string(),accepted:z.number().int(),cancelled:z.boolean(),completed:z.boolean().optional()}).parse(await request('/delivery',{action:'import',taskId:JSON.parse(job.selection).taskId,id,fingerprint:job.fingerprint,items}));
  if(receipt.id!==id||receipt.taskId!==JSON.parse(job.selection).taskId||receipt.fingerprint!==job.fingerprint||receipt.accepted!==items.length)throw Error('Oktell подтвердил другую загрузку');
  if(receipt.completed)throw Error('Партия завершена в Oktell. Подтвердите завершение партии для освобождения клиентов.');
  const state=receipt.cancelled?'cancelled':'delivered';
  await d.batch([
   d.prepare('UPDATE oktell_deliveries SET state=?,updated_at=?,error=\'\' WHERE id=? AND state<>\'cancelled\'').bind(state,new Date().toISOString(),id),
   d.prepare("UPDATE oktell_delivery_items SET state=? WHERE job_id=? AND state IN ('reserved','delivered') AND EXISTS(SELECT 1 FROM oktell_deliveries WHERE id=? AND state=?)").bind(state,id,id,state),
  ]);return {id,state:(await d.prepare('SELECT state FROM oktell_deliveries WHERE id=?').bind(id).first()).state,accepted:receipt.accepted};
 }catch(e){await d.prepare("UPDATE oktell_deliveries SET state='unknown',updated_at=?,error=? WHERE id=? AND state NOT IN ('delivered','cancelled','completed')").bind(new Date().toISOString(),e instanceof Error?e.message:'Нет подтверждения Oktell',id).run();throw e;}
}
export async function cancelOktellDelivery(d:Db,id:string,request:typeof pilotControl=pilotControl){
 id=z.string().uuid().parse(id).toLowerCase();await initOktellDelivery(d);
 const job=await d.prepare('SELECT * FROM oktell_deliveries WHERE id=?').bind(id).first();if(!job)throw Error('Загрузка не найдена');if(['cancelled','completed'].includes(job.state))return {id,state:job.state};
 if(await d.prepare('SELECT chain FROM oktell_delivery_calls WHERE job_id=? LIMIT 1').bind(id).first())throw Error('Партия уже участвовала в звонках. Сначала требуется завершение и сверка очереди Oktell');
 // An uncertain import is reconciled with the same id before requesting cancellation.
 if(job.state!=='delivered')await sendOktellDelivery(d,id,request);
 const receipt=z.object({id:z.string().uuid(),fingerprint:z.string(),cancelled:z.literal(true)}).parse(await request('/delivery',{action:'cancel',taskId:JSON.parse(job.selection).taskId,id}));
 if(receipt.id!==id||receipt.fingerprint!==job.fingerprint)throw Error('Oktell не подтвердил отмену этой загрузки');
 await d.batch([d.prepare("UPDATE oktell_deliveries SET state='cancelled',updated_at=?,error='' WHERE id=?").bind(new Date().toISOString(),id),d.prepare("UPDATE oktell_delivery_items SET state='cancelled' WHERE job_id=?").bind(id)]);
 return {id,state:'cancelled'};
}

export async function completeOktellDelivery(d:Db,id:string,request:typeof pilotControl=pilotControl){
 id=z.string().uuid().parse(id).toLowerCase();await initOktellDelivery(d);
 const job=await d.prepare('SELECT * FROM oktell_deliveries WHERE id=?').bind(id).first();
 if(!job||job.state==='cancelled')throw Error('Действующая партия не найдена');
 if(job.state==='completed')return {id,state:'completed'};
 // Import confirmed calls/results before releasing assignment and phone guards.
 const {syncOktellBackground}=await import('./oktell-background.ts');
 const synced=await syncOktellBackground(d,request);
 if(synced.through===undefined)throw Error('Синхронизация Т1 не настроена');
 const taskId=JSON.parse(job.selection).taskId;
 const receipt=z.object({id:z.string().uuid(),taskId:z.string().uuid(),fingerprint:z.string(),accepted:z.number().int(),cancelled:z.literal(false),completed:z.literal(true)}).parse(await request('/delivery',{action:'complete',taskId,id,through:synced.through}));
 const count=(await d.prepare('SELECT COUNT(*) n FROM oktell_delivery_items WHERE job_id=?').bind(id).first()).n;
 if(receipt.id!==id||receipt.taskId!==taskId||receipt.fingerprint!==job.fingerprint||receipt.accepted!==count)throw Error('Oktell подтвердил завершение другой партии');
 await d.batch([
  d.prepare("UPDATE oktell_deliveries SET state='completed',updated_at=?,error='' WHERE id=? AND state<>'cancelled'").bind(new Date().toISOString(),id),
  d.prepare("UPDATE oktell_delivery_items SET state='completed' WHERE job_id=? AND EXISTS(SELECT 1 FROM oktell_deliveries WHERE id=? AND state='completed')").bind(id,id),
 ]);
 return {id,state:'completed'};
}
