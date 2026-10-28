import {z} from 'zod';
import type {ActivityDb} from './activity-store.ts';
import {initPhone,normalizeOutgoingNumber} from './phone-store.ts';
import {pilotSchema,pilotSetting} from './oktell-pilot.ts';
import {pilotControl} from './oktell-pilot-control.ts';
const call=z.object({chain:z.string().uuid(),actor:z.string(),phone:z.string(),client_id:z.string(),started_at:z.string().datetime(),answered_at:z.string().datetime().nullable(),ended_at:z.string().datetime().nullable(),status:z.enum(['ringing','connected','no_answer','completed']),updated_at:z.string().datetime(),result:z.string().nullable(),command_id:z.string().uuid().nullable(),command_state:z.enum(['sent','unknown','confirmed']).nullable()});
// The private bridge is the authority for native task events; browser input never assigns clients.
export async function syncPilot(d:ActivityDb,rows?:unknown){
 const setting=await d.prepare('SELECT data FROM settings WHERE id=?').bind(pilotSetting).first();if(!setting)return;
 const p=pilotSchema.parse(JSON.parse(setting.data));if(!p.native)return;
 const calls=z.array(call).max(100).parse(rows??await pilotControl('/pilot-history'));
 await initPhone(d);
 for(const c of calls.sort((a,b)=>a.started_at.localeCompare(b.started_at))){
  if(!p.operatorIds.includes(c.actor)||!p.contacts.some(x=>normalizeOutgoingNumber(x.phone)===c.phone&&(!x.clientId||x.clientId===c.client_id)))throw Error('Состав Т1 изменился');
  const [client,employee]=await Promise.all([d.prepare('SELECT data FROM clients WHERE id=?').bind(c.client_id).first(),d.prepare('SELECT data FROM employees WHERE id=?').bind(c.actor).first()]);
  if(!client||!employee)throw Error('Карточка Т1 или оператор не найдены');
  const cl=JSON.parse(client.data),e=JSON.parse(employee.data);
  if(normalizeOutgoingNumber(cl.phone)!==c.phone||e.role!=='operator'||e.oktell?.status!=='linked')throw Error('Привязка Т1 не совпадает');
  const id=c.chain.replaceAll('-',''),existing=await d.prepare('SELECT id FROM phone_calls WHERE id=?').bind(id).first();
  const result=c.result?z.object({outcome:z.string().max(80),comment:z.string().max(3000),callbackAt:z.string().datetime().nullable()}).parse(JSON.parse(c.result)):null;
  const text='Т1 · '+(result?result.outcome+(result.comment?' · '+result.comment:'')+(result.callbackAt?' · Перезвон '+new Date(result.callbackAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК':''):'автообзвон Oktell');
  const statements=[];
  if(!existing){
   // Assign only this validated test contact, once, when the PBX hands it to an operator.
   statements.push(d.prepare("UPDATE clients SET data=json_set(data,'$.owner',?,'$.assignedUntil',?,'$.assignmentStartedAt',?),version=version+1 WHERE id=? AND NOT EXISTS(SELECT 1 FROM phone_calls WHERE id=?)").bind(c.actor,new Date(Date.parse(c.started_at)+31*86400000).toISOString(),c.started_at,c.client_id,id));
   statements.push(d.prepare("INSERT OR IGNORE INTO phone_calls(id,client_id,actor_id,actor_name,caller_number,started_at,status,detail) SELECT ?,?,?,?,?,?,'dialing','Т1 · автообзвон Oktell' WHERE NOT EXISTS(SELECT 1 FROM phone_calls WHERE id=?)").bind(id,c.client_id,c.actor,e.name,'',c.started_at,id));
  }
  statements.push(d.prepare("UPDATE phone_calls SET answered_at=?,ended_at=?,status=?,bill_seconds=?,duration=?,detail=?,provider_at=? WHERE id=? AND actor_id=? AND detail LIKE 'Т1 · %' AND (provider_at IS NULL OR provider_at<=?)").bind(c.answered_at,c.ended_at,c.status==='ringing'?'dialing':c.status,c.answered_at&&c.ended_at?Math.max(0,Math.round((Date.parse(c.ended_at)-Date.parse(c.answered_at))/1000)):0,c.ended_at?Math.max(0,Math.round((Date.parse(c.ended_at)-Date.parse(c.started_at))/1000)):0,text+(result?' · '+(c.command_state==='confirmed'?'Oktell подтвердил':'подтверждение Oktell ожидается'):''),c.updated_at,id,c.actor,c.updated_at));
  if(result&&c.command_id){
   const event={id:c.command_id,clientId:c.client_id,orderId:'',at:c.updated_at,actor:e.name,actorId:c.actor,text:text+' · '+(c.command_state==='confirmed'?'Oktell подтвердил':'ожидается подтверждение Oktell')};
   statements.push(d.prepare("INSERT INTO events(id,client_id,order_id,at,data) VALUES(?,?,'',?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE events.at<=excluded.at").bind(c.command_id,c.client_id,c.updated_at,JSON.stringify(event)));
  }
  await d.batch(statements);
 }
 return {calls:calls.length};
}
