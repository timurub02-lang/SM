import {z} from 'zod';
import type {ActivityDb as Db} from './activity-store.ts';
import {initPhone,normalizeOutgoingNumber} from './phone-store.ts';
import {statuses,type Order} from './crm.ts';
import {cdekStatuses} from './cdek-statuses.ts';
const rule=z.object({crm:z.array(z.string()).default([]),cdek:z.array(z.string()).default([])});
export const replacementSchema=z.object({enabled:z.boolean(),threshold:z.number().int().min(0).max(1000000),enable:rule,disable:rule,release:rule}).superRefine((v,c)=>{
 for(const name of ['enable','disable','release'] as const){for(const value of v[name].crm)if(!(value in statuses))c.addIssue({code:'custom',message:'Неизвестный статус CRM'});for(const value of v[name].cdek)if(!cdekStatuses.some(s=>s.code===value))c.addIssue({code:'custom',message:'Неизвестный статус СДЭК'});}
});
export const replacementDefaults={enabled:false,threshold:500,enable:{crm:[],cdek:[]},disable:{crm:[],cdek:[]},release:{crm:[],cdek:[]}};
export type ReplacementConfig=z.infer<typeof replacementSchema>;
export async function initReplacement(d:Db){
 await initPhone(d);
 await d.batch([
  d.prepare('CREATE TABLE IF NOT EXISTS replacement_numbers(number TEXT PRIMARY KEY,uses INTEGER NOT NULL DEFAULT 0,added_at TEXT NOT NULL,last_assigned_at TEXT)'),
  d.prepare('CREATE TABLE IF NOT EXISTS replacement_assignments(id TEXT PRIMARY KEY,number TEXT NOT NULL REFERENCES replacement_numbers(number),order_id TEXT NOT NULL,client_id TEXT NOT NULL,client_name TEXT NOT NULL,assigned_at TEXT NOT NULL,released_at TEXT,release_reason TEXT,connected INTEGER NOT NULL DEFAULT 0)'),
  d.prepare('CREATE UNIQUE INDEX IF NOT EXISTS replacement_active_number ON replacement_assignments(number) WHERE released_at IS NULL'),
  d.prepare('CREATE UNIQUE INDEX IF NOT EXISTS replacement_active_order ON replacement_assignments(order_id) WHERE released_at IS NULL'),
  d.prepare('CREATE INDEX IF NOT EXISTS replacement_history ON replacement_assignments(number,assigned_at)'),
  d.prepare("INSERT OR IGNORE INTO settings(id,data) VALUES('phone-replacement',?)").bind(JSON.stringify({...replacementDefaults,revision:crypto.randomUUID()}))
 ]);
 await d.batch([
 d.prepare(`CREATE TRIGGER IF NOT EXISTS replacement_exclusive BEFORE INSERT ON replacement_numbers WHEN EXISTS(SELECT 1 FROM phone_numbers WHERE number=NEW.number) BEGIN SELECT RAISE(ABORT,'Номер уже в Билайн АТС'); END`),
 d.prepare(`CREATE TRIGGER IF NOT EXISTS outgoing_exclusive BEFORE INSERT ON phone_numbers WHEN EXISTS(SELECT 1 FROM replacement_numbers WHERE number=NEW.number) BEGIN SELECT RAISE(ABORT,'Номер уже в Замене телефона'); END`)
 ]);
 // Status rules run in the same transaction as every CRM/CDEK order update, including background jobs.
 const changed="json_extract(NEW.data,'$.status') IS NOT json_extract(OLD.data,'$.status') OR json_extract(NEW.data,'$.cdekStatus.code') IS NOT json_extract(OLD.data,'$.cdekStatus.code')";
 const matches=(name:string)=>`EXISTS(SELECT 1 FROM settings,json_each(settings.data,'$.${name}.crm') WHERE settings.id='phone-replacement' AND json_each.value=json_extract(NEW.data,'$.status')) OR EXISTS(SELECT 1 FROM settings,json_each(settings.data,'$.${name}.cdek') WHERE settings.id='phone-replacement' AND json_each.value=json_extract(NEW.data,'$.cdekStatus.code'))`;
 await d.prepare(`CREATE TRIGGER IF NOT EXISTS replacement_status AFTER UPDATE OF data ON orders WHEN ${changed} BEGIN
 UPDATE replacement_assignments SET connected=CASE WHEN (${matches('release')}) OR (${matches('disable')}) THEN 0 WHEN (${matches('enable')}) THEN 1 ELSE connected END,
 released_at=CASE WHEN (${matches('release')}) THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,
 release_reason=CASE WHEN (${matches('release')}) THEN 'CRM: '||json_extract(NEW.data,'$.status')||'; СДЭК: '||COALESCE(json_extract(NEW.data,'$.cdekStatus.code'),'—') ELSE release_reason END WHERE order_id=NEW.id AND released_at IS NULL;
 END`).run();
}
export async function replacementConfig(d:Db){await initReplacement(d);const row=await d.prepare("SELECT data FROM settings WHERE id='phone-replacement'").first();return {...replacementDefaults,...JSON.parse(row.data)} as ReplacementConfig&{revision:string};}
export function replacementDecision(config:ReplacementConfig,order:Pick<Order,'status'|'cdekStatus'>){
 const match=(r:ReplacementConfig['enable'])=>r.crm.includes(order.status)||!!order.cdekStatus&&r.cdek.includes(order.cdekStatus.code);
 return match(config.release)?'release':match(config.disable)?'disable':match(config.enable)?'enable':'disable';
}
export async function replacementHealth(d:Db){const row=await d.prepare("SELECT data FROM settings WHERE id='phone-replacement-health'").first();return row?JSON.parse(row.data):null;}
export async function replacementPhone(d:Db,order:Order,realPhone:string){
 const config=await replacementConfig(d),existing=await d.prepare('SELECT * FROM replacement_assignments WHERE order_id=? AND released_at IS NULL').bind(order.id).first();
 if(!config.enabled&&!existing)return {phone:realPhone};
 const health=await replacementHealth(d);if(!health?.at||Date.now()-Date.parse(health.at)>180000)throw Error('Сервис замены телефона недоступен. Выгрузка остановлена');
 if(existing&&!health.numbers?.includes(existing.number))throw Error('Номер ещё не синхронизирован с АТС');
 if(existing)return {phone:'+'+existing.number,assignmentId:existing.id};
 if(replacementDecision(config,order)==='release')throw Error('Текущий статус заказа настроен на освобождение номера. Проверьте правила подмены');
 const id=crypto.randomUUID(),at=new Date().toISOString();
 await d.batch([
  d.prepare(`INSERT OR IGNORE INTO replacement_assignments(id,number,order_id,client_id,client_name,assigned_at,connected)
   SELECT ?,n.number,o.id,o.client_id,json_extract(c.data,'$.name'),?,? FROM replacement_numbers n,orders o JOIN clients c ON c.id=o.client_id
   WHERE o.id=? AND o.version=? AND n.number IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM replacement_assignments a WHERE a.number=n.number AND a.released_at IS NULL)
   AND NOT EXISTS(SELECT 1 FROM replacement_assignments a WHERE a.order_id=o.id AND a.released_at IS NULL)
   ORDER BY n.uses,COALESCE(n.last_assigned_at,''),n.added_at,n.number LIMIT 1`).bind(id,at,replacementDecision(config,order)==='enable'?1:0,order.id,order.version,JSON.stringify(health.numbers||[])),
  d.prepare('UPDATE replacement_numbers SET uses=uses+1,last_assigned_at=? WHERE number=(SELECT number FROM replacement_assignments WHERE id=?)').bind(at,id)
 ]);
 const assigned=await d.prepare('SELECT * FROM replacement_assignments WHERE order_id=? AND released_at IS NULL').bind(order.id).first();
 if(assigned)return {phone:'+'+assigned.number,assignmentId:assigned.id};
 const current=await d.prepare('SELECT version FROM orders WHERE id=?').bind(order.id).first();if(!current||current.version!==order.version)throw Error('Заказ изменился. Обновите карточку');
 const free=await d.prepare('SELECT COUNT(*) n FROM replacement_numbers n WHERE NOT EXISTS(SELECT 1 FROM replacement_assignments a WHERE a.number=n.number AND a.released_at IS NULL)').first();if(free.n)throw Error('Пул номеров ещё не синхронизирован с АТС');
 return {phone:realPhone,fallback:true};
}
export async function replacementRoute(d:Db,number:string){
 await initReplacement(d);const normalized=normalizeOutgoingNumber(number);if(!normalized)return {mode:'regular'};
 const pool=await d.prepare('SELECT number FROM replacement_numbers WHERE number=?').bind(normalized).first();if(!pool)return {mode:'regular'};
 const row=await d.prepare('SELECT a.*,c.phone FROM replacement_assignments a LEFT JOIN clients c ON c.id=a.client_id WHERE a.number=? AND a.released_at IS NULL').bind(normalized).first();
 if(!row)return {mode:'free'};
 if(!row.connected)return {mode:'wait',seconds:60};
 const destination=normalizeOutgoingNumber(row.phone||'');if(!destination)throw Error('Нет корректного основного номера клиента');
 if(await d.prepare('SELECT number FROM replacement_numbers WHERE number=?').bind(destination).first())throw Error('Нельзя соединять подменные номера между собой');
 return {mode:'connect',destination,callerId:normalized,assignmentId:row.id};
}
export async function replacementTasks(d:Db){
 const config=await replacementConfig(d);if(!config.enabled)return [];
 const count=await d.prepare('SELECT COUNT(*) n FROM replacement_numbers n WHERE NOT EXISTS(SELECT 1 FROM replacement_assignments a WHERE a.number=n.number AND a.released_at IS NULL)').first();
 const health=await replacementHealth(d),tasks=[];const base={kind:'task' as const,clientId:'',at:health?.at||new Date().toISOString()};
 if(count.n<config.threshold)tasks.push({...base,id:'replacement:low',title:'Мало свободных подменных номеров',text:`Свободно ${count.n}, порог ${config.threshold}. Добавьте номера в «Замена телефона».`});
 if(!health?.at||Date.now()-Date.parse(health.at)>180000)tasks.push({...base,id:'replacement:offline',title:'Сбой сервиса замены телефона',text:'Выгрузка с подменой остановлена. Проверьте новую АТС.'});
 const failure=await d.prepare("SELECT data FROM settings WHERE id='phone-replacement-error'").first();if(failure)tasks.push({...base,id:'replacement:error',title:'Ошибка замены телефона',...JSON.parse(failure.data)});
 return tasks;
}
