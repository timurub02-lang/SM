import type {ActivityDb} from './activity-store.ts';
import type {Employee} from './crm.ts';
import {readFile} from 'node:fs/promises';

export type WidgetTarget = {mode:'client';clientId:string}|{mode:'order';orderId:string}|{mode:'incoming';incomingId:string};

type PilotEmployee=Pick<Employee,'id'|'role'|'impersonation'>;
export function skWidgetConfig(employee:PilotEmployee, crmOrigin:string, config:{origin?:string;pilots?:Record<string,unknown>}){
  if(employee.impersonation||!['operator','department_head','admin'].includes(employee.role))return null;
  try{
    const origin=new URL(config.origin||'');
    if(origin.protocol!=='https:'||origin.origin!==config.origin||[crmOrigin,'https://crm.smanalytics.ru','https://smcrm.ru'].includes(origin.origin))return null;
    const pilots=config.pilots||{};
    const skUserId=Object.hasOwn(pilots,employee.id)?pilots[employee.id]:null;
    if(typeof skUserId!=='string'||!/^[1-9]\d{0,18}$/.test(skUserId))return null;
    return {origin:origin.origin,skUserId};
  }catch{return null;}
}

export async function readSkWidgetConfig(employee:PilotEmployee,crmOrigin:string){
  try{
    const config=JSON.parse(await readFile(process.env.CRM_SK_WIDGET_CONFIG_PATH||'/etc/sm-crm-sk-widget.json','utf8'));
    return skWidgetConfig(employee,crmOrigin,config);
  }catch{return null;}
}

const prefix='Скорозвон · ';
export async function reserveSkCall(d:ActivityDb,id:string,employee:Employee,target:WidgetTarget,clientId:string){
  // This trigger also prevents an existing PBX route from starting over an active widget call.
  await d.prepare(`CREATE TRIGGER IF NOT EXISTS sk_widget_one_active BEFORE INSERT ON phone_calls
    WHEN EXISTS(SELECT 1 FROM phone_calls c WHERE c.actor_id=NEW.actor_id AND c.ended_at IS NULL
      AND (NEW.detail LIKE 'Скорозвон · %' OR EXISTS(SELECT 1 FROM sk_widget_calls w WHERE w.call_id=c.id))
      AND c.status IN ('preparing','dialing','connected') AND julianday(c.started_at)>julianday('now','-32 minutes'))
    BEGIN SELECT RAISE(ABORT,'Завершите текущий звонок перед новым вызовом'); END`).run();
  const writes=[d.prepare(`INSERT INTO phone_calls(id,client_id,order_id,actor_id,actor_name,caller_number,started_at,status,detail)
    VALUES(?,?,?,?,?,'',?,'preparing',?)`).bind(id,clientId||null,target.mode==='order'?target.orderId:null,employee.id,employee.name,new Date().toISOString(),prefix+'подготовка'),
    d.prepare('INSERT INTO sk_widget_calls(call_id) VALUES(?)').bind(id)];
  if(target.mode==='incoming')writes.push(d.prepare('INSERT INTO phone_call_incoming(call_id,incoming_id) VALUES(?,?)').bind(id,target.incomingId));
  await d.batch(writes);
}

export type SkCallUpdate='connected'|'ended'|'answered-end'|'failed'|'unknown';
export async function updateSkCall(d:ActivityDb,id:string,employeeId:string,event:SkCallUpdate){
  const now=new Date().toISOString(),connected=event==='connected',answered=connected||event==='answered-end';
  const status=connected?'connected':answered?'completed':event==='failed'?'failed':'unknown';
  const description=connected?'соединение установлено':answered?'разговор завершён':event==='failed'?'набор отклонён':'итог соединения не подтверждён';
  return d.prepare(`UPDATE phone_calls SET status=?,detail=?,answered_at=CASE WHEN ? THEN COALESCE(answered_at,?) ELSE answered_at END,
    ended_at=CASE WHEN ? THEN NULL ELSE ? END WHERE id=? AND actor_id=? AND id IN (SELECT call_id FROM sk_widget_calls) AND ended_at IS NULL`)
    .bind(status,prefix+description,answered?1:0,now,connected?1:0,now,id,employeeId).run();
}
