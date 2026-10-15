import type {ActivityDb as Db} from './activity-store.ts';
import type {Employee} from './crm.ts';
export const actions={date:'Дата',nd:'НД',refusal:'Отказ',work:'В работе',po:'Под ответственность'};
export const results={date:'Дата',none:'НД',to_return:'На возврат',returned:'Возврат',delivered:'Вручен',courier:'У курьера'};
export const dayOf=(now=new Date())=>new Date(now.getTime()+10800000).toISOString().slice(0,10);
export const dayPlus=(day:string,n:number)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export function refusalRetryDate(day:string){let date=day;for(let count=0;count<2;){date=dayPlus(date,1);const weekday=new Date(date+'T12:00:00Z').getUTCDay();if(weekday!==0&&weekday!==6)count++;}return date;}
export const closedTime=(now=new Date())=>new Date(now.getTime()+10800000).toISOString().slice(11,16)>='19:50';
export const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export const defaults={statuses:[] as string[],projectId:'',automatic:false,headsAll:false};
export async function initRedemption(d:Db){await d.batch([
 d.prepare(`CREATE TABLE IF NOT EXISTS redemption_entries(order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,entered_at TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1)`),
 d.prepare(`CREATE TABLE IF NOT EXISTS redemption_history(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,at TEXT NOT NULL,data TEXT NOT NULL)`),
 d.prepare('CREATE INDEX IF NOT EXISTS redemption_history_at ON redemption_history(at)'),
 d.prepare(`CREATE TABLE IF NOT EXISTS redemption_archives(day TEXT PRIMARY KEY,at TEXT NOT NULL,data TEXT NOT NULL)`),
 d.prepare(`CREATE TABLE IF NOT EXISTS redemption_dispatch(day TEXT PRIMARY KEY,state TEXT NOT NULL,data TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL)`),
 d.prepare(`CREATE TRIGGER IF NOT EXISTS redemption_history_update AFTER UPDATE OF data ON redemption_entries WHEN NEW.data<>OLD.data BEGIN INSERT INTO redemption_history(order_id,at,data) VALUES(NEW.order_id,COALESCE(json_extract(NEW.data,'$.updatedAt'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),NEW.data); END`),
 ...['INSERT','UPDATE OF data'].map((event,i)=>d.prepare(`CREATE TRIGGER IF NOT EXISTS redemption_enter_${i} AFTER ${event} ON orders WHEN json_extract(NEW.data,'$.delivery') IN ('cdek_pickup','cdek_courier') AND EXISTS(SELECT 1 FROM settings,json_each(settings.data,'$.statuses') WHERE settings.id='redemption-config' AND json_each.value=json_extract(NEW.data,'$.cdekStatus.code')) BEGIN INSERT OR IGNORE INTO redemption_entries(order_id,entered_at,data) VALUES(NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'{}'); END`))
]);}
export async function redemptionConfig(d:Db){return {...defaults,...JSON.parse((await d.prepare("SELECT data FROM settings WHERE id='redemption-config'").first())?.data||'{}')};}
export async function syncRedemption(d:Db,now=new Date()){
 await initRedemption(d);const at=now.toISOString();
 await d.prepare(`INSERT OR IGNORE INTO redemption_entries(order_id,entered_at,data) SELECT o.id,?,'{}' FROM orders o WHERE json_extract(o.data,'$.delivery') IN ('cdek_pickup','cdek_courier') AND EXISTS(SELECT 1 FROM settings,json_each(settings.data,'$.statuses') WHERE settings.id='redemption-config' AND json_each.value=json_extract(o.data,'$.cdekStatus.code'))`).bind(at).run();
 await d.prepare(`UPDATE redemption_entries SET data=json_set(data,'$.operatorReturn.resolvedAt',?,'$.operatorReturn.outcome','Оператор не проработал заказ','$.result','to_return','$.resultDate','','$.dateConfirmation',NULL,'$.author','Система','$.authorId','system','$.changedBy','Система','$.changeKind','operator_return_timeout','$.updatedAt',?,'$.lastDay',?),version=version+1 WHERE json_extract(data,'$.operatorReturn.deadline')<=? AND json_extract(data,'$.operatorReturn.resolvedAt') IS NULL`).bind(at,at,dayOf(now),at).run();
 await d.prepare(`UPDATE redemption_entries SET data=json_set(data,'$.result','delivered','$.author','API','$.authorId','API','$.resultDate','','$.changedBy','API','$.changeKind','delivery','$.updatedAt',?,'$.lastDay',?),version=version+1 WHERE COALESCE(json_extract(data,'$.result'),'') NOT IN ('delivered','to_return','returned') AND EXISTS(SELECT 1 FROM orders o WHERE o.id=order_id AND json_extract(o.data,'$.cdekStatus.code')='DELIVERED')`).bind(at,dayOf(now)).run();
 await d.prepare(`UPDATE redemption_entries SET data=json_set(data,'$.operatorReturn.resolvedAt',?,'$.operatorReturn.outcome','Вручен','$.updatedAt',?,'$.changeKind','delivery'),version=version+1 WHERE json_extract(data,'$.result')='delivered' AND json_extract(data,'$.operatorReturn') IS NOT NULL AND json_extract(data,'$.operatorReturn.resolvedAt') IS NULL`).bind(at,at).run();
 await d.prepare(`UPDATE redemption_entries SET data=json_set(data,'$.result','','$.changedBy','Система','$.changeKind','rollover','$.updatedAt',?),version=version+1 WHERE json_extract(data,'$.result')='none' AND json_extract(data,'$.lastDay')<?`).bind(at,dayOf(now)).run();
 await d.prepare(`UPDATE redemption_entries SET data=json_set(data,'$.dateConfirmation','pending','$.changedBy','Система','$.changeKind','date_confirmation_migration','$.updatedAt',?),version=version+1 WHERE json_extract(data,'$.dateConfirmation') IS NULL AND json_extract(data,'$.result')='date' AND json_extract(data,'$.action') IN ('date','work','po') AND COALESCE(json_extract(data,'$.resultDate'),'')>=?`).bind(at,dayOf(now)).run();
 await d.prepare(`UPDATE redemption_entries SET data=json_set(data,'$.dateConfirmation','expired','$.changedBy','Система','$.changeKind','date_confirmation_expired','$.updatedAt',?),version=version+1 WHERE json_extract(data,'$.dateConfirmation')='pending' AND json_extract(data,'$.result')='date' AND json_extract(data,'$.resultDate')<?`).bind(at,dayOf(now)).run();
}
export const returnReasons=['Уточнить дату доставки','Получить окончательное решение клиента','Отработать отказ','Другое'];
export function awaitingOperator(row:any){return !!row.operatorReturn&&!row.operatorReturn.resolvedAt;}
export function awaitingDateConfirmation(row:any){return !awaitingOperator(row)&&row.dateConfirmation==='pending'&&row.result==='date';}
export function awaitingReturn(row:any){return !awaitingOperator(row)&&row.result==='to_return';}
export function canSeeRedemption(e:Employee,row:any,headsAll:boolean){if(awaitingOperator(row))return ['admin','redemption'].includes(e.role)||e.role==='operator'&&row.manager===e.id||e.role==='department_head'&&!!e.department&&row.department===e.department;if((awaitingDateConfirmation(row)||awaitingReturn(row))&&!['admin','redemption'].includes(e.role))return false;return ['admin','redemption'].includes(e.role)||e.role==='operator'&&row.manager===e.id||e.role==='department_head'&&(headsAll||!!e.department&&row.department===e.department);}
export function inWorkday(r:any,day:string){if(awaitingOperator(r)||awaitingReturn(r)||r.result==='returned'||awaitingDateConfirmation(r))return false;if((r.dateConfirmation==='confirmed'||r.refusalRetryUsed&&r.action==='refusal')&&r.result==='date'&&r.resultDate>day)return false;if(dayOf(new Date(r.entered_at))>day)return false;if(r.result==='delivered')return r.lastDay===day;return r.lastDay===day||!r.resultDate||r.result!=='date'||r.resultDate<=day;}
export function inRedemptionTab(row:any,tab:string,day:string){if(awaitingOperator(row))return (row.operatorReturn.sourceTab||'work')===tab;return tab==='confirm'?awaitingDateConfirmation(row):tab==='returns'?awaitingReturn(row):inWorkday(row,day);}
export async function redemptionRows(d:Db){const rows=(await d.prepare(`SELECT r.*,o.data order_data,c.data client_data,e.data employee_data,s.data shipment FROM redemption_entries r JOIN orders o ON o.id=r.order_id JOIN clients c ON c.id=o.client_id LEFT JOIN employees e ON e.id=json_extract(o.data,'$.manager') LEFT JOIN settings s ON s.id='cdek-shipment-'||o.id ORDER BY r.entered_at,r.order_id`).all()).results;return rows.map((r:any)=>{const o=JSON.parse(r.order_data),c=JSON.parse(r.client_data),e=JSON.parse(r.employee_data||'{}'),v=JSON.parse(r.data);return {order_id:r.order_id,entered_at:r.entered_at,version:r.version,...v,clientId:c.id,clientName:c.name,phone:c.phone,manager:o.manager,operator:e.name||'',login:e.login||'',department:e.department||'',status:o.cdekStatus?.code||'',track:JSON.parse(r.shipment||'{}').number||o.testTrack||'',storageUntil:o.cdekStorageUntil||v.manualStorage||'',storageSource:o.cdekStorageUntil?'СДЭК':v.manualStorage?'Вручную':'Не указан',testOnly:!!o.testOnly,total:(o.items||[]).reduce((sum:number,i:any)=>sum+i.quantity*i.price,0),comments:v.comments||[],days:v.days||{}};});}
export function allowedResults(action:string,row:any,role:string,day:string){
 if(awaitingOperator(row))return action==='refusal'?['to_return']:(action==='date'&&row.storageUntil&&row.storageUntil>day||action==='po'&&row.storageUntil&&row.storageUntil<=day)?['date']:[];
 if(row.result==='to_return')return role==='redemption'?['returned']:[];
 const expired=row.storageUntil&&row.storageUntil<=day;
 if(expired&&!['refusal','po'].includes(action))return [];
 if(action==='date'||action==='work')return ['date'];
 if(action==='nd')return ['none'];
 if(action==='refusal')return row.refusalRetryUsed?['to_return']:[...(!expired&&row.storageUntil&&refusalRetryDate(day)<=row.storageUntil?['date']:[]),'to_return',...(role==='redemption'?['returned']:[])];
 if(action==='po')return expired||row.storageUntil&&refusalRetryDate(day)>row.storageUntil?['date']:[];
 return [];
}
export async function editRedemption(d:Db,e:Employee,p:any,now=new Date()){
 const cfg=await redemptionConfig(d),row=(await redemptionRows(d)).find((r:any)=>r.order_id===p.id);if(!row||!canSeeRedemption(e,row,cfg.headsAll))throw Error('Заказ недоступен');
 if(awaitingOperator(row)&&row.operatorReturn.deadline<=now.toISOString())throw Error('Два часа истекли. Заказ возвращён отделу выкупа; обновите список');
 if(awaitingOperator(row)&&['admin','redemption'].includes(e.role))throw Error('Заказ находится у оператора и недоступен для изменений');
 if(closedTime(now)&&!row.testOnly&&!awaitingOperator(row))throw Error('День закрыт в 19:50. Изменения доступны завтра');
 if(['returned','delivered'].includes(row.result))throw Error('Работа с заказом завершена');
 const saved=await d.prepare('SELECT data FROM redemption_entries WHERE order_id=?').bind(p.id).first(),v=JSON.parse(saved.data),day=dayOf(now),at=now.toISOString();
 const next={...v,updatedAt:at,changedBy:e.name,changeKind:p.operation||'action'};
 if(p.operation==='return_operator'){
  if(!['admin','redemption'].includes(e.role)||awaitingOperator(row))throw Error('Вернуть заказ может администратор или сотрудник выкупа');
  if(awaitingDateConfirmation(row)||awaitingReturn(row))throw Error('Из вкладок подтверждения нельзя вернуть заказ оператору');
  const manager=await d.prepare('SELECT data FROM employees WHERE id=?').bind(row.manager).first();
  if(!manager||JSON.parse(manager.data).role!=='operator')throw Error('У заказа нет ответственного оператора');
  if(!returnReasons.includes(p.reason)||typeof p.comment!=='string'||p.comment.length>2000||p.reason==='Другое'&&!p.comment.trim())throw Error('Выберите причину и заполните комментарий для «Другое»');
  Object.assign(next,{operatorReturn:{sourceTab:awaitingReturn(row)?'returns':awaitingDateConfirmation(row)?'confirm':'work',reason:p.reason,comment:p.comment.trim(),author:e.name,authorId:e.id,at,deadline:new Date(now.getTime()+2*60*60*1000).toISOString()}});
 }else if(p.operation==='confirm_date'){if(!['admin','redemption'].includes(e.role)||!awaitingDateConfirmation(row)||row.resultDate<day)throw Error('Подтверждение доступно администратору и сотруднику выкупа для ожидающей даты');Object.assign(next,{dateConfirmation:'confirmed',dateConfirmedBy:e.name,dateConfirmedById:e.id,dateConfirmedAt:at});}
 else if(p.operation==='comment'){if(typeof p.text!=='string'||!p.text.trim()||p.text.length>3000)throw Error('Введите комментарий до 3000 символов');next.comments=[...(v.comments||[]),{id:crypto.randomUUID(),text:p.text.trim(),author:e.name,authorId:e.id,at}];}
 else if(p.operation==='storage'){if(row.storageSource==='СДЭК')throw Error('Срок получен из СДЭК');if(!validDate(p.date||''))throw Error('Укажите срок хранения');next.manualStorage=p.date;next.storageAuthor=e.name;}
 else {
  if(!(p.action in actions)||!allowedResults(p.action,row,e.role,day).includes(p.result))throw Error('Этот результат недоступен для действия или роли');
  if(awaitingOperator(row)&&p.action==='po'&&p.responsibilityConfirmed!==true)throw Error('Подтвердите, что клиент точно выкупит заказ после окончания срока хранения');
  let date='';if(p.result==='date'){
   if(!row.storageUntil&&p.action!=='po')throw Error('Сначала укажите срок хранения');
   date=p.action==='refusal'?refusalRetryDate(day):p.date;
   if(!validDate(date||'')||date<day||p.action!=='po'&&date>row.storageUntil)throw Error('Дата должна быть не раньше сегодня и не позже СХ');
  }
  if(awaitingOperator(row))next.operatorReturn={...v.operatorReturn,resolvedAt:at,resolvedBy:e.name,resolvedById:e.id};
  Object.assign(next,{refusalRetryUsed:!!v.refusalRetryUsed||p.action==='refusal'&&p.result==='date',dateConfirmation:p.result==='date'&&['date','work','po'].includes(p.action)?'pending':null,dateConfirmedBy:null,dateConfirmedById:null,dateConfirmedAt:null,action:p.action,result:p.result,resultDate:date,author:e.name,authorId:e.id,authorRole:e.role,lastDay:day,days:{...(v.days||{}),[day]:{action:p.action,result:p.result,date,author:e.name,at}}});
 }
 const result=await d.prepare('UPDATE redemption_entries SET data=?,version=version+1 WHERE order_id=? AND version=?').bind(JSON.stringify(next),p.id,p.version).run();if(!result.meta.changes)throw Error('Заказ изменён другим сотрудником. Обновите таблицу');
}
export async function archiveRedemption(d:Db,now=new Date()){
 await syncRedemption(d,now);const day=dayOf(now);if(!closedTime(now))return;
 const rows=(await redemptionRows(d)).filter((r:any)=>inWorkday(r,day)||awaitingDateConfirmation(r)||awaitingReturn(r)||awaitingOperator(r)||r.lastDay===day||r.updatedAt&&dayOf(new Date(r.updatedAt))===day);
 await d.prepare('INSERT OR IGNORE INTO redemption_archives(day,at,data) VALUES(?,?,?)').bind(day,now.toISOString(),JSON.stringify(rows)).run();
}
