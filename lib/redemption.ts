import {locationZone} from './client-local-time.ts';
import {internalDeadline,upgradeInternalDeadline} from './internal-timers.ts';
import {canEditOrderRedemption} from './redemption-priority.ts';
import {incomingForAction} from './incoming.ts';
import type {ActivityDb as Db} from './activity-store.ts';
import type {Employee} from './crm.ts';
export const actions={date:'Дата',nd:'НД',refusal:'Отказ',work:'В работе',courier:'У курьера',client_delivered:'Вручен со слов клиента',po:'Под ответственность'};
export const results={date:'Дата',none:'НД',to_return:'На возврат',returned:'Возврат',delivered:'Вручен',courier:'У курьера',client_delivered:'Вручен со слов клиента',operator:'Передать оператору'};
export const dayOf=(now=new Date())=>new Date(now.getTime()+10800000).toISOString().slice(0,10);
export const dayPlus=(day:string,n:number)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export function redemptionHeadScope(now=new Date()){
 const day=dayOf(now),cutoff=Date.parse(day+'T13:01:00+03:00');
 const headsAll=now.getTime()<cutoff;
 return {headsAll,until:headsAll?cutoff:Date.parse(dayPlus(day,1)+'T00:00:00+03:00')};
}
export function refusalRetryDate(day:string){let date=day;for(let count=0;count<2;){date=dayPlus(date,1);const weekday=new Date(date+'T12:00:00Z').getUTCDay();if(weekday!==0&&weekday!==6)count++;}return date;}
export function redemptionDayAuthor(row:{author?:string;lastDay?:string},day:string){return row.lastDay===day?row.author||'':'';}
export function redemptionRowAuthor(row:{author?:string;lastDay?:string},tab:string,day:string){return tab==='work'?redemptionDayAuthor(row,day):row.author||'';}
export function redemptionNdCount(row:any,day:string){const entry=row.days?.[day];return entry?.ndCount||(entry?.action==='nd'||row.lastDay===day&&row.action==='nd'?1:0);}
function compareRedemptionPriority(a:any,b:any,tab:string,day:string){return Number(tab==='returns'&&a.result==='returned')-Number(tab==='returns'&&b.result==='returned')||Number(tab==='confirm'&&dateConfirmedToday(a,day))-Number(tab==='confirm'&&dateConfirmedToday(b,day))||Number(awaitingOperator(a))-Number(awaitingOperator(b))||Number(['delivered','to_return','returned'].includes(a.result))-Number(['delivered','to_return','returned'].includes(b.result));}
export function compareRedemptionRows(a:any,b:any,tab:string,day:string){return compareRedemptionPriority(a,b,tab,day)||(tab==='work'?(a.result==='none'?redemptionNdCount(a,day):0)-(b.result==='none'?redemptionNdCount(b,day):0):0);}
export function compareRedemptionPeople(a:any,b:any,column:'operator'|'author',ascending:boolean,tab:string,day:string,showLogin=false){
 const value=(row:any)=>column==='author'?redemptionRowAuthor(row,tab,day):showLogin&&!['delivered','returned'].includes(row.result)&&!awaitingOperator(row)?row.login||row.operator||'':row.operator||'';
 return compareRedemptionPriority(a,b,tab,day)||(ascending?1:-1)*value(a).localeCompare(value(b),'ru',{sensitivity:'base',numeric:true});
}
export const closedTime=(now=new Date())=>new Date(now.getTime()+10800000).toISOString().slice(11,16)>='19:50';
export const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function redemptionDateLimit(day:string,storageUntil='',action=''){
 const [year,month,date]=day.split('-').map(Number),last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
 const limit=new Date(Date.UTC(year,month,Math.min(date,last))).toISOString().slice(0,10);
 return storageUntil&&action!=='po'&&storageUntil<limit?storageUntil:limit;
}
export function operatorReturnDeadline(storageUntil:string,now=new Date()){
 const limit=internalDeadline(now.toISOString(),48);
 return validDate(storageUntil||'')?[limit,storageUntil+'T20:59:59.999Z'].sort()[0]:limit;
}
export const defaults={statuses:[] as string[],projectId:'',automatic:false};
const redemptionSchemas=new WeakMap<Db,Promise<unknown>>();
// Repeated CDEK checks still update their timestamp, but do not duplicate business history.
const redemptionHistoryTrigger=`CREATE TRIGGER redemption_history_update AFTER UPDATE OF data ON redemption_entries WHEN NEW.data<>OLD.data AND NOT (json_extract(NEW.data,'$.changeKind') IS 'return_check' AND json_extract(OLD.data,'$.changeKind') IS 'return_check' AND json_remove(NEW.data,'$.updatedAt','$.returnCheck.at')=json_remove(OLD.data,'$.updatedAt','$.returnCheck.at')) BEGIN INSERT INTO redemption_history(order_id,at,data) VALUES(NEW.order_id,COALESCE(json_extract(NEW.data,'$.updatedAt'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),NEW.data); END`;
export async function initRedemption(d:Db){let schema=redemptionSchemas.get(d);if(!schema){schema=d.batch([
 d.prepare(`CREATE TABLE IF NOT EXISTS redemption_entries(order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,entered_at TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1)`),
 d.prepare(`CREATE TABLE IF NOT EXISTS redemption_history(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,at TEXT NOT NULL,data TEXT NOT NULL)`),
 d.prepare('CREATE INDEX IF NOT EXISTS redemption_history_at ON redemption_history(at)'),
 d.prepare('CREATE INDEX IF NOT EXISTS redemption_history_order_at ON redemption_history(order_id,at)'),
 d.prepare(`CREATE TABLE IF NOT EXISTS redemption_archives(day TEXT PRIMARY KEY,at TEXT NOT NULL,data TEXT NOT NULL)`),
 d.prepare(`CREATE TABLE IF NOT EXISTS redemption_dispatch(day TEXT PRIMARY KEY,state TEXT NOT NULL,data TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL)`),
 ...['INSERT','UPDATE OF data'].map((event,i)=>d.prepare(`CREATE TRIGGER IF NOT EXISTS redemption_enter_${i} AFTER ${event} ON orders WHEN json_extract(NEW.data,'$.delivery') IN ('cdek_pickup','cdek_courier') AND EXISTS(SELECT 1 FROM settings,json_each(settings.data,'$.statuses') WHERE settings.id='redemption-config' AND json_each.value=json_extract(NEW.data,'$.cdekStatus.code')) BEGIN INSERT OR IGNORE INTO redemption_entries(order_id,entered_at,data) VALUES(NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'{}'); END`))
]).then(async()=>{const current=await d.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='redemption_history_update'").first();if(current?.sql!==redemptionHistoryTrigger)await d.batch([d.prepare('DROP TRIGGER IF EXISTS redemption_history_update'),d.prepare(redemptionHistoryTrigger)]);});redemptionSchemas.set(d,schema);schema.catch(()=>redemptionSchemas.delete(d));}await schema;}
export async function redemptionConfig(d:Db){return {...defaults,...JSON.parse((await d.prepare("SELECT data FROM settings WHERE id='redemption-config'").first())?.data||'{}')};}
export async function syncRedemption(d:Db,now=new Date()){
 await initRedemption(d);const at=now.toISOString();
 await d.prepare(`INSERT OR IGNORE INTO redemption_entries(order_id,entered_at,data) SELECT o.id,?,'{}' FROM orders o WHERE json_extract(o.data,'$.delivery') IN ('cdek_pickup','cdek_courier') AND EXISTS(SELECT 1 FROM settings,json_each(settings.data,'$.statuses') WHERE settings.id='redemption-config' AND json_each.value=json_extract(o.data,'$.cdekStatus.code'))`).bind(at).run();
 await d.prepare(`UPDATE redemption_entries SET data=json_set(data,'$.pendingEnrollment',json('false')),entered_at=?,version=version+1 WHERE json_extract(data,'$.pendingEnrollment')=1 AND EXISTS(SELECT 1 FROM orders o WHERE o.id=order_id AND json_extract(o.data,'$.status')='shipping' AND EXISTS(SELECT 1 FROM settings,json_each(settings.data,'$.statuses') WHERE settings.id='redemption-config' AND json_each.value=json_extract(o.data,'$.cdekStatus.code')))` ).bind(at).run();
 // Release previously scheduled refusal follow-ups once, without restarting active deadlines.
 await d.prepare(`UPDATE redemption_entries SET data=json_set(data,'$.operatorReturn.previousStartsAt',json_extract(data,'$.operatorReturn.startsAt'),'$.operatorReturn.startsAt',?,'$.operatorReturn.timerCalendar','weekdays-v1','$.operatorReturn.deadline',?,'$.resultDate',?,'$.changedBy','Система','$.changeKind','operator_return_start_now','$.updatedAt',?),version=version+1 WHERE json_extract(data,'$.operatorReturn.startsAt')>? AND json_extract(data,'$.operatorReturn.resolvedAt') IS NULL AND json_extract(data,'$.action')='refusal' AND json_extract(data,'$.result')='date'`).bind(at,internalDeadline(now.toISOString(),48),dayOf(now),at,at).run();
 // Extend live legacy handoffs from their original start; never revive expired work.
 await d.prepare(`UPDATE redemption_entries SET data=json_set(data,'$.operatorReturn.durationHours',48,'$.operatorReturn.deadline',strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(json_extract(data,'$.operatorReturn.startsAt'),json_extract(data,'$.operatorReturn.at')),'+48 hours'),'$.changedBy','Система','$.changeKind','operator_return_48_hours','$.updatedAt',?),version=version+1 WHERE COALESCE(json_extract(data,'$.operatorReturn.durationHours'),0)<>48 AND json_extract(data,'$.operatorReturn.resolvedAt') IS NULL AND json_extract(data,'$.operatorReturn.deadline')>? AND json_extract(data,'$.operatorReturn.deadline') IN (strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(json_extract(data,'$.operatorReturn.startsAt'),json_extract(data,'$.operatorReturn.at')),'+2 hours'),strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(json_extract(data,'$.operatorReturn.startsAt'),json_extract(data,'$.operatorReturn.at')),'+10 hours'))`).bind(at,at).run();
 // Upgrade unresolved saved deadlines before expiry; the following storage cap remains calendar time.
 const legacyReturns=await d.prepare("SELECT order_id,data,version FROM redemption_entries WHERE json_extract(data,'$.operatorReturn.deadline') IS NOT NULL AND json_extract(data,'$.operatorReturn.resolvedAt') IS NULL AND COALESCE(json_extract(data,'$.operatorReturn.timerCalendar'),'')<>'weekdays-v1'").all();
 for(const row of legacyReturns.results){
  const data=JSON.parse(row.data);data.operatorReturn={...data.operatorReturn,timerCalendar:'weekdays-v1',deadline:upgradeInternalDeadline(data.operatorReturn.deadline)};
  data.updatedAt=at;data.changedBy='Система';data.changeKind='operator_return_weekdays';
  await d.prepare('UPDATE redemption_entries SET data=?,version=version+1 WHERE order_id=? AND version=?').bind(JSON.stringify(data),row.order_id,row.version).run();
 }
 // A storage date ends at 23:59:59.999 Moscow time; shrinking it also shortens live handoffs.
 const storageEnd="(SELECT json_extract(o.data,'$.cdekStorageUntil')||'T20:59:59.999Z' FROM orders o WHERE o.id=order_id AND date(json_extract(o.data,'$.cdekStorageUntil'))=json_extract(o.data,'$.cdekStorageUntil'))";
 await d.prepare(`UPDATE redemption_entries SET data=json_set(data,'$.operatorReturn.deadline',${storageEnd},'$.operatorReturn.durationHours',48,'$.changedBy','Система','$.changeKind','operator_return_storage_limit','$.updatedAt',?),version=version+1 WHERE json_extract(data,'$.operatorReturn.resolvedAt') IS NULL AND json_extract(data,'$.operatorReturn.deadline')>${storageEnd}`).bind(at).run();
 await d.prepare(`UPDATE redemption_entries SET data=json_set(data,'$.operatorReturn.resolvedAt',?,'$.operatorReturn.outcome','Оператор не проработал заказ','$.result','to_return','$.resultDate','','$.dateConfirmation',NULL,'$.author','Система','$.authorId','system','$.changedBy','Система','$.changeKind','operator_return_timeout','$.updatedAt',?,'$.lastDay',?),version=version+1 WHERE json_extract(data,'$.operatorReturn.deadline')<=? AND json_extract(data,'$.operatorReturn.resolvedAt') IS NULL`).bind(at,at,dayOf(now),at).run();
 await d.prepare(`UPDATE redemption_entries SET data=json_set(data,'$.result','delivered','$.author','API','$.authorId','API','$.resultDate','','$.changedBy','API','$.changeKind','delivery','$.updatedAt',?,'$.lastDay',?),version=version+1 WHERE COALESCE(json_extract(data,'$.result'),'') NOT IN ('delivered','to_return','returned') AND EXISTS(SELECT 1 FROM orders o WHERE o.id=order_id AND json_extract(o.data,'$.cdekStatus.code')='DELIVERED')`).bind(at,dayOf(now)).run();
 await d.prepare(`UPDATE redemption_entries SET data=json_set(data,'$.operatorReturn.resolvedAt',?,'$.operatorReturn.outcome','Вручен','$.updatedAt',?,'$.changeKind','delivery'),version=version+1 WHERE json_extract(data,'$.result')='delivered' AND json_extract(data,'$.operatorReturn') IS NOT NULL AND json_extract(data,'$.operatorReturn.resolvedAt') IS NULL`).bind(at,at).run();
 await d.prepare(`UPDATE redemption_entries SET data=json_set(data,'$.result','','$.changedBy','Система','$.changeKind','rollover','$.updatedAt',?),version=version+1 WHERE json_extract(data,'$.result')='none' AND json_extract(data,'$.lastDay')<?`).bind(at,dayOf(now)).run();
 await d.prepare(`UPDATE redemption_entries SET data=json_set(data,'$.dateConfirmation','pending','$.changedBy','Система','$.changeKind','date_confirmation_migration','$.updatedAt',?),version=version+1 WHERE json_extract(data,'$.dateConfirmation') IS NULL AND json_extract(data,'$.result')='date' AND json_extract(data,'$.action') IN ('date','work','po') AND COALESCE(json_extract(data,'$.resultDate'),'')>=?`).bind(at,dayOf(now)).run();
 await d.prepare(`UPDATE redemption_entries SET data=json_set(data,'$.dateConfirmation','expired','$.changedBy','Система','$.changeKind','date_confirmation_expired','$.updatedAt',?),version=version+1 WHERE json_extract(data,'$.dateConfirmation')='pending' AND json_extract(data,'$.result')='date' AND json_extract(data,'$.resultDate')<?`).bind(at,dayOf(now)).run();
}
export const returnReasons=['Уточнить дату доставки','Получить окончательное решение клиента','Отработать отказ','Другое'];
export function awaitingOperator(row:any){return !!row.operatorReturn&&!row.operatorReturn.resolvedAt;}
export function operatorReturnScheduled(row:any,now=new Date()){return awaitingOperator(row)&&!!row.operatorReturn.startsAt&&row.operatorReturn.startsAt>now.toISOString();}
export function awaitingDateConfirmation(row:any){return !awaitingOperator(row)&&row.dateConfirmation==='pending'&&row.result==='date';}
export function awaitingReturn(row:any){return !awaitingOperator(row)&&row.result==='to_return';}
export function canSeeRedemption(e:Employee,row:any,headsAll:boolean){if(awaitingOperator(row))return ['admin','redemption'].includes(e.role)||e.role==='operator'&&row.manager===e.id||e.role==='department_head'&&!!e.department&&row.department===e.department;if((awaitingDateConfirmation(row)||awaitingReturn(row))&&!['admin','redemption'].includes(e.role)&&!(awaitingDateConfirmation(row)&&(e.role==='operator'&&row.manager===e.id||e.role==='department_head'&&!!e.department&&row.department===e.department)))return false;return ['admin','redemption'].includes(e.role)||e.role==='operator'&&row.manager===e.id||e.role==='department_head'&&(headsAll||!!e.department&&row.department===e.department);}
export async function operatorReturnCount(d:Db,employee:Employee){
 await initRedemption(d);
 const rows=await d.prepare(`SELECT json_extract(o.data,'$.manager') manager,json_extract(e.data,'$.department') department
  FROM redemption_entries r JOIN orders o ON o.id=r.order_id JOIN clients c ON c.id=o.client_id
  LEFT JOIN employees e ON e.id=json_extract(o.data,'$.manager')
  WHERE NOT COALESCE(json_extract(r.data,'$.pendingEnrollment'),0) AND json_type(r.data,'$.operatorReturn')='object'
  AND COALESCE(json_extract(r.data,'$.operatorReturn.resolvedAt'),'')=''`).all();
 return rows.results.filter((row:{manager:string;department:string})=>canSeeRedemption(employee,{...row,operatorReturn:{}},false)).length;
}
export function inWorkday(r:any,day:string){if(r.pendingEnrollment||r.incomingScheduled&&r.result==='date'&&r.resultDate>day)return false;if(awaitingOperator(r)||awaitingReturn(r)||r.result==='returned'||awaitingDateConfirmation(r))return false;if((r.dateConfirmation==='confirmed'||r.refusalRetryUsed&&r.action==='refusal')&&r.result==='date'&&r.resultDate>day)return false;if(dayOf(new Date(r.entered_at))>day)return false;if(r.result==='delivered')return r.lastDay===day;return r.lastDay===day||!r.resultDate||r.result!=='date'||r.resultDate<=day;}
export function dateConfirmedToday(row:any,day:string){return row.dateConfirmation==='confirmed'&&row.result==='date'&&!!row.dateConfirmedAt&&dayOf(new Date(row.dateConfirmedAt))===day;}
export function returnConfirmedToday(row:any,day:string){return row.result==='returned'&&!!row.returnConfirmedAt&&dayOf(new Date(row.returnConfirmedAt))===day;}
export function inRedemptionTab(row:any,tab:string,day:string){if(row.pendingEnrollment)return false;if(awaitingOperator(row))return (row.operatorReturn.sourceTab||'work')===tab;return tab==='confirm'?(awaitingDateConfirmation(row)||dateConfirmedToday(row,day)&&!row.dateVerifiedAt):tab==='returns'?(awaitingReturn(row)||row.result==='returned'&&!!row.returnWaybill&&row.returnCheck?.state!=='verified'):inWorkday(row,day);}
export async function redemptionRows(d:Db,includePending=false){const rows=(await d.prepare(`SELECT r.*,o.data order_data,c.data client_data,e.data employee_data,s.data shipment FROM redemption_entries r JOIN orders o ON o.id=r.order_id JOIN clients c ON c.id=o.client_id LEFT JOIN employees e ON e.id=json_extract(o.data,'$.manager') LEFT JOIN settings s ON s.id='cdek-shipment-'||o.id ORDER BY r.entered_at,r.order_id`).all()).results;return rows.filter((r:any)=>includePending||!JSON.parse(r.data).pendingEnrollment).map((r:any)=>{const o=JSON.parse(r.order_data),c=JSON.parse(r.client_data),e=JSON.parse(r.employee_data||'{}'),v=JSON.parse(r.data),shipment=JSON.parse(r.shipment||'{}');return {timeZone:locationZone(o)||locationZone({address:shipment.deliveryAddress||o.cdekTariff?.deliveryPoint?.address})||locationZone(c),order_id:r.order_id,entered_at:r.entered_at,version:r.version,...v,clientId:c.id,clientName:c.name,phone:c.phone,manager:o.manager,operator:e.name||'',login:e.login||'',department:e.department||'',status:o.cdekStatus?.code||'',track:shipment.number||o.testTrack||'',storageUntil:o.cdekStorageUntil||(o.testOnly?v.manualStorage:'')||'',storageSource:o.cdekStorageUntil?'СДЭК':o.testOnly&&v.manualStorage?'Тестовые данные':'Не указан',testOnly:!!o.testOnly,total:(o.items||[]).reduce((sum:number,i:any)=>sum+i.quantity*i.price,0),comments:v.comments||[],days:v.days||{}};});}
export function allowedResults(action:string,row:any,role:string,day:string){
 if(awaitingOperator(row))return action==='refusal'?['to_return']:(action==='date'&&row.storageUntil&&row.storageUntil>day||action==='po'&&row.storageUntil&&row.storageUntil<=day)?['date']:[];
 if(row.result==='to_return')return role==='redemption'&&action==='refusal'?['returned']:[];
 if(action==='client_delivered')return ['client_delivered'];
 const expired=row.storageUntil&&row.storageUntil<=day;
 if(expired&&!['refusal','po'].includes(action))return [];
 if(action==='date'||action==='work')return ['date',...(action==='work'&&role==='department_head'&&!awaitingDateConfirmation(row)&&row.storageUntil&&row.storageUntil>day?['operator']:[])];
 if(action==='nd')return ['none'];
 if(action==='courier')return ['courier'];
 if(action==='refusal')return row.refusalRetryUsed?['to_return']:[...(!expired&&row.storageUntil?['date']:[]),'to_return',...(role==='redemption'?['returned']:[])];
 if(action==='po')return expired||row.storageUntil&&refusalRetryDate(day)>row.storageUntil?['date']:[];
 return [];
}
export function futureRedemptionDate(row:any,day=dayOf()){return row.result==='date'&&!!row.resultDate&&row.resultDate>day;}
export async function prepareIncomingRedemption(d:Db,e:Employee,orderId:string,incomingId:string,now=new Date()){
 if(!['operator','redemption'].includes(e.role)||typeof incomingId!=='string'||!incomingId||incomingId.length>100)throw Error('Обращение недоступно');
 const stored=await d.prepare('SELECT client_id,data FROM orders WHERE id=?').bind(orderId).first();
 const o=JSON.parse(stored?.data||'{}');
 if(!stored||e.role==='operator'&&(o.manager!==e.id||o.status!=='shipping')||e.role==='redemption'&&!['shipping','pickup'].includes(o.status)||!o.delivery?.startsWith('cdek_'))throw Error('Результат выкупа недоступен для этого заказа');
 const incoming=await incomingForAction(d,incomingId,e,[],stored.client_id);
 if(e.role==='redemption'&&incoming.order_id&&incoming.order_id!==orderId)throw Error('Обращение относится к другому заказу');
 await initRedemption(d);
 await d.prepare('INSERT OR IGNORE INTO redemption_entries(order_id,entered_at,data) VALUES(?,?,?)').bind(orderId,now.toISOString(),JSON.stringify({pendingEnrollment:e.role!=='redemption'})).run();
}
export async function editRedemption(d:Db,e:Employee,p:any,now=new Date()){
 if(p.incomingId!==undefined)await prepareIncomingRedemption(d,e,p.id,p.incomingId,now);

 const cfg=await redemptionConfig(d),row=(await redemptionRows(d,!!p.incomingId)).find((r:any)=>r.order_id===p.id);if(!row||!canSeeRedemption(e,row,redemptionHeadScope(now).headsAll))throw Error('Заказ недоступен');
 if(p.version!==row.version)throw Error('Заказ изменён другим сотрудником. Обновите результат');
 if(p.source==='order'){const stored=await d.prepare('SELECT data FROM orders WHERE id=?').bind(p.id).first();const order=JSON.parse(stored?.data||'{}');const manager=await d.prepare('SELECT data FROM employees WHERE id=?').bind(order.manager||'').first();if(!(e.role==='redemption'&&p.incomingId)&&!canEditOrderRedemption(e,order,manager?{...JSON.parse(manager.data),id:order.manager}:undefined)||!p.incomingId&&!cfg.statuses.includes(order.cdekStatus?.code))throw Error('Результат выкупа недоступен для этого заказа');}
 let incoming:any=null;
 if(p.incomingId!==undefined){
  if(typeof p.incomingId!=='string'||!p.incomingId||p.incomingId.length>100||p.source!=='order'||p.operation)throw Error('Некорректный итог входящего обращения');
  incoming=await incomingForAction(d,p.incomingId,e,[],row.clientId);
 }
 const future=futureRedemptionDate(row,dayOf(now)),actionChange=!p.operation||p.operation==='action';
 if(future&&actionChange&&p.action!=='nd'&&p.replaceConfirmed!==true)throw Error('Подтвердите замену назначенного результата');
 if(operatorReturnScheduled(row,now))throw Error('Заказ доступен для обработки в назначенный день с 09:00 МСК');
 if(awaitingOperator(row)&&[row.operatorReturn.deadline,operatorReturnDeadline(row.storageUntil,now)].sort()[0]<=now.toISOString())throw Error('Срок обработки истёк. Заказ возвращён отделу выкупа; обновите список');
 if(awaitingOperator(row)&&['admin','redemption'].includes(e.role))throw Error('Заказ находится у оператора и недоступен для изменений');
 if(!(actionChange&&future)&&p.operation!=='verify_date'&&dateConfirmedToday(row,dayOf(now))&&row.resultDate>dayOf(now))throw Error('Подтверждение уже выполнено. Заказ доступен для работы в назначенную дату');
 if(closedTime(now)&&!row.testOnly&&!awaitingOperator(row))throw Error('День закрыт в 19:50. Изменения доступны завтра');
 if(!(p.operation==='return_waybill'&&row.result==='returned'&&row.returnCheck?.state!=='verified')&&['returned','delivered'].includes(row.result))throw Error('Работа с заказом завершена');
 const saved=await d.prepare('SELECT data FROM redemption_entries WHERE order_id=?').bind(p.id).first(),v=JSON.parse(saved.data),day=dayOf(now),at=now.toISOString();
 const next={...v,updatedAt:at,changedBy:e.name,changeKind:p.operation||'action',changeSource:incoming?'incoming':null,sourceIncomingId:incoming?.id||null};
 async function persist(){
  if(!incoming){const saved=await d.prepare('UPDATE redemption_entries SET data=?,version=version+1 WHERE order_id=? AND version=?').bind(JSON.stringify(next),p.id,p.version).run();if(!saved.meta.changes)throw Error('Заказ изменён другим сотрудником. Обновите результат');return;}
  const mutation=crypto.randomUUID();
  const reason=actions[p.action as keyof typeof actions]+' · '+results[p.result as keyof typeof results]+(next.resultDate?' · '+next.resultDate:'')+(p.comment.trim()?' · '+p.comment.trim():'');
  const event={id:'INCOMING-'+incoming.id,clientId:row.clientId,orderId:p.id,at,actor:e.name,actorId:e.id,text:'Итог входящего обращения · '+reason};
  const gate="EXISTS(SELECT 1 FROM redemption_entries WHERE order_id=? AND json_extract(data,'$.incomingMutation')=?)";
  const saved=await d.batch([
   d.prepare("UPDATE redemption_entries SET data=?,version=version+1 WHERE order_id=? AND version=? AND EXISTS(SELECT 1 FROM incoming_calls WHERE id=? AND closed_at IS NULL AND spam=0 AND client_id=? AND assignee_id IS ?)").bind(JSON.stringify({...next,incomingMutation:mutation}),p.id,p.version,incoming.id,row.clientId,incoming.assignee_id),
   ...(p.action==='nd'?[]:[
    d.prepare('UPDATE incoming_calls SET closed_at=?,closed_by=?,reason=?,order_id=? WHERE id=? AND closed_at IS NULL AND '+gate).bind(at,e.id,reason,p.id,incoming.id,p.id,mutation),
    d.prepare('INSERT INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE '+gate).bind(event.id,event.clientId,event.orderId,at,JSON.stringify(event),p.id,mutation)
   ])
  ]);
  if(!saved[0].meta.changes)throw Error('Заказ или обращение уже изменены. Обновите данные');
 }

 if(p.operation==='return_operator'){
  if(!['admin','redemption'].includes(e.role)||awaitingOperator(row))throw Error('Вернуть заказ может администратор или сотрудник выкупа');
  if(awaitingDateConfirmation(row)||awaitingReturn(row))throw Error('Из вкладок подтверждения нельзя вернуть заказ оператору');
  const manager=await d.prepare('SELECT data FROM employees WHERE id=?').bind(row.manager).first();
  if(!manager||JSON.parse(manager.data).role!=='operator')throw Error('У заказа нет ответственного оператора');
  if(!returnReasons.includes(p.reason)||typeof p.comment!=='string'||p.comment.length>2000||p.reason==='Другое'&&!p.comment.trim())throw Error('Выберите причину и заполните комментарий для «Другое»');
  if(!validDate(row.storageUntil||''))throw Error('СДЭК пока не передал срок хранения');
  const deadline=operatorReturnDeadline(row.storageUntil,now);if(deadline<=at)throw Error('Срок хранения истёк. Передача оператору недоступна');
  Object.assign(next,{operatorReturn:{sourceTab:awaitingReturn(row)?'returns':awaitingDateConfirmation(row)?'confirm':'work',reason:p.reason,comment:p.comment.trim(),author:e.name,authorId:e.id,at,timerCalendar:"weekdays-v1",durationHours:48,deadline}});
 }else if(p.operation==='verify_return'){throw Error('Возврат подтверждается автоматически через API СДЭК');}
 else if(p.operation==='return_waybill'){
  if(e.role!=='redemption'||!['to_return','returned'].includes(row.result)||row.returnCheck?.state==='verified')throw Error('Изменение накладной недоступно');
  if(typeof p.returnWaybill!=='string'||!p.returnWaybill.trim()||p.returnWaybill.trim().length>100||typeof p.comment!=='string'||!p.comment.trim()||p.comment.length>3000)throw Error('Укажите номер возвратной накладной и комментарий');
  Object.assign(next,{result:'returned',returnWaybill:p.returnWaybill.trim(),returnConfirmedAt:at,returnCheck:{state:'pending',at},returnVerifiedAt:null,returnVerifiedBy:null,author:e.name,authorId:e.id});
  next.comments=[...(v.comments||[]),{id:crypto.randomUUID(),text:p.comment.trim(),author:e.name,authorId:e.id,at}];
 }
 else if(p.operation==='verify_date'){if(!['admin','redemption'].includes(e.role)||!dateConfirmedToday(row,day)||row.dateVerifiedAt)throw Error('Проверить может сотрудник выкупа после подтверждения даты');Object.assign(next,{dateVerifiedAt:at,dateVerifiedBy:e.name,dateVerifiedById:e.id});}
 else if(p.operation==='confirm_date'){if(!['admin','redemption'].includes(e.role)||!awaitingDateConfirmation(row)||row.resultDate<day)throw Error('Подтверждение доступно администратору и сотруднику выкупа для ожидающей даты');Object.assign(next,{dateConfirmation:'confirmed',dateConfirmedBy:e.name,dateConfirmedById:e.id,dateConfirmedAt:at});}
 else if(p.operation==='operator_nd'){
  if(!awaitingOperator(row)||!['operator','department_head'].includes(e.role))throw Error('Отметка НД доступна оператору в возвращённом заказе');
  if(typeof p.comment!=='string'||p.comment.length>3000)throw Error('Комментарий должен быть до 3000 символов');
  next.operatorReturn={...v.operatorReturn,attempts:[...(v.operatorReturn.attempts||[]),{action:'nd',author:e.name,authorId:e.id,at,comment:p.comment.trim()}]};
 }
 else if(p.operation==='comment'){if(typeof p.text!=='string'||!p.text.trim()||p.text.length>3000)throw Error('Введите комментарий до 3000 символов');next.comments=[...(v.comments||[]),{id:crypto.randomUUID(),text:p.text.trim(),author:e.name,authorId:e.id,at}];}
 else if(p.operation==='storage'){throw Error('Срок хранения обновляется автоматически из СДЭК');}
 else {
  if(!(p.action in actions)||!(incoming&&p.action==='po'&&p.result==='date'&&row.storageUntil)&&!(future&&p.action==='nd'&&p.result==='none')&&!allowedResults(p.action,row,e.role,day).includes(p.result))throw Error('Этот результат недоступен для действия или роли');
  if(typeof p.comment!=='string'||p.action!=='nd'&&!p.comment.trim()||p.comment.length>3000)throw Error('Укажите комментарий к действию (до 3000 символов)');
  if(p.comment.trim())next.comments=[...(v.comments||[]),{id:crypto.randomUUID(),text:p.comment.trim(),author:e.name,authorId:e.id,at}];
  if(future&&p.action==='nd'){next.changeKind='missed_attempt';next.lastAttempt={action:'nd',author:e.name,authorId:e.id,at};await persist();return;}
  if(p.result==='returned'){if(typeof p.returnWaybill!=='string'||!p.returnWaybill.trim()||p.returnWaybill.trim().length>100)throw Error('Укажите номер возвратной накладной (до 100 символов)');Object.assign(next,{returnWaybill:p.returnWaybill.trim(),returnConfirmedAt:at,returnCheck:{state:'pending',at},returnVerifiedAt:null,returnVerifiedBy:null});}
  if((awaitingOperator(row)||incoming)&&p.action==='po'&&p.responsibilityConfirmed!==true)throw Error('Подтвердите, что клиент точно выкупит заказ после окончания срока хранения');
  const workHandoff=p.action==='work'&&p.result==='operator';
  if(workHandoff&&e.role!=='department_head')throw Error('Передать заказ через «В работе» может только руководитель отдела');
  let date='';if(p.result==='date'||workHandoff){
   if(!row.storageUntil&&(workHandoff||!['date','work'].includes(p.action))&&(p.action!=='po'||incoming))throw Error('СДЭК пока не передал срок хранения');
   date=p.action==='refusal'||workHandoff?day:p.date;
   if(incoming&&p.action==='po'&&date<=row.storageUntil)throw Error('Под ответственность выберите дату после срока хранения');
   if(!validDate(date||'')||date<day||date>redemptionDateLimit(day,row.storageUntil,p.action))throw Error('Дата должна быть не раньше сегодня, не дальше одного месяца и в пределах СХ (кроме «Под ответственность»)');
  }
  if(p.action==='refusal'&&p.result==='date'||workHandoff){
   const manager=await d.prepare('SELECT data FROM employees WHERE id=?').bind(row.manager).first();
   if(!manager||JSON.parse(manager.data).role!=='operator')throw Error('У заказа нет ответственного оператора');
   next.operatorReturn={sourceTab:'work',reason:workHandoff?'Другое':'Отработать отказ',comment:workHandoff?p.comment.trim():'Проработать отказ сразу после передачи',author:e.name,authorId:e.id,at,timerCalendar:"weekdays-v1",durationHours:48,deadline:operatorReturnDeadline(row.storageUntil,now)};
  }
  if(awaitingOperator(row))next.operatorReturn={...v.operatorReturn,resolvedAt:at,resolvedBy:e.name,resolvedById:e.id};
  Object.assign(next,{incomingScheduled:!!incoming&&p.result==='date',resultSource:incoming?'incoming':null,refusalRetryUsed:!!v.refusalRetryUsed||p.action==='refusal'&&p.result==='date',dateConfirmation:p.result==='date'&&['date','work','po'].includes(p.action)?(incoming?'incoming':'pending'):null,dateConfirmedBy:null,dateConfirmedById:null,dateConfirmedAt:null,dateVerifiedAt:null,dateVerifiedBy:null,dateVerifiedById:null,action:p.action,result:workHandoff?'date':p.result,resultDate:date,author:e.name,authorId:e.id,authorRole:e.role,lastDay:day,days:{...(v.days||{}),[day]:{action:p.action,result:workHandoff?'date':p.result,date,author:e.name,at,ndCount:redemptionNdCount(v,day)+(p.action==='nd'?1:0)}}});
 }
 await persist();
}
export async function archiveRedemption(d:Db,now=new Date()){
 await syncRedemption(d,now);const day=dayOf(now);if(!closedTime(now))return;
 const rows=(await redemptionRows(d)).filter((r:any)=>inWorkday(r,day)||awaitingDateConfirmation(r)||awaitingReturn(r)||awaitingOperator(r)||r.lastDay===day||r.updatedAt&&dayOf(new Date(r.updatedAt))===day);
 await d.prepare('INSERT OR IGNORE INTO redemption_archives(day,at,data) VALUES(?,?,?)').bind(day,now.toISOString(),JSON.stringify(rows.map((r:any)=>inRedemptionTab(r,'work',day)?{...r,author:redemptionDayAuthor(r,day)}:r))).run();
}

export function redemptionResultLabel(row:{action?:string;result?:string;resultDate?:string}){
 const action=actions[row.action as keyof typeof actions],result=results[row.result as keyof typeof results]||'Ещё не указан';
 return [action,action===result?undefined:result,row.resultDate?.split('-').reverse().join('.')].filter(Boolean).join(' · ');
}
