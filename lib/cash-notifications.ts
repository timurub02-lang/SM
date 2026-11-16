import type {ActivityDb} from './activity-store.ts';
import {initReminderStore} from './reminder-store.ts';

// Triggers cover every cash writer and commit the notice with the operation.
export async function initCashNotifications(d:ActivityDb){
 await initReminderStore(d);
 for(const operation of ['INSERT','UPDATE'] as const){
  const actor=operation==='UPDATE'?'NEW.recipient':'NEW.actor';
  const title=operation==='UPDATE'?"'Перевод принят в кассу'":"CASE NEW.kind WHEN 'add' THEN 'Пополнение кассы' WHEN 'spend' THEN 'Расход из кассы' WHEN 'transfer' THEN 'Перевод между кассами' ELSE 'Оплата заказа поступила в кассу' END";
  const at=operation==='UPDATE'?'NEW.accepted_at':'NEW.created_at';
  const suffix=operation==='UPDATE'?"':accepted'":"':created'";
  await d.prepare(`CREATE TRIGGER IF NOT EXISTS cash_notice_${operation} AFTER ${operation} ON cash_operations ${operation==='UPDATE'?'WHEN OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL':''} BEGIN
   INSERT OR IGNORE INTO reminders(employee_id,id,data,at)
   SELECT e.id,'cash:'||NEW.id||${suffix},json_object('kind','cash-change','id','cash:'||NEW.id||${suffix},'clientId','','title',${title},'text',COALESCE((SELECT json_extract(data,'$.name') FROM employees WHERE id=${actor}),${actor})||' · '||COALESCE(NULLIF(NEW.sender_name,''),'Внешнее поступление')||CASE WHEN NEW.recipient_name<>'' THEN ' → '||NEW.recipient_name ELSE '' END||' · '||printf('%.2f',NEW.amount/100.0)||' ₽ · '||NEW.purpose,'at',${at}),${at}
   FROM employees e WHERE json_extract(e.data,'$.role')='admin'; END`).run();
 }
}
export async function acknowledgeCashNotice(d:ActivityDb,employee:{id:string;role:string},id:string,at:string){
 if(employee.role!=='admin')throw Error('Ознакомление с кассой доступно администратору');
 const result=await d.prepare("UPDATE reminders SET data=json_set(data,'$.acknowledgedAt',?),read_at=COALESCE(read_at,?) WHERE employee_id=? AND id=? AND json_extract(data,'$.kind')='cash-change'").bind(at,at,employee.id,id).run();
 if(!result.meta.changes)throw Error('Уведомление об изменении кассы не найдено');
}
