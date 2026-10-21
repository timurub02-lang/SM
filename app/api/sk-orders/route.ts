import {z} from 'zod';
import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {initSkOrders,skStaff,skClient,skSender,skMayDecide,acceptSkOrder,type SkOrderInput} from '@/lib/sk-order-import';
async function context(){const actor=(await getChatGPTUser())?.employee;if(!actor||!['admin','department_head','operator'].includes(actor.role))throw Error('Недостаточно прав');const d=db();await initSkOrders(d);return {actor,d,staff:await skStaff(d)};}
export const GET=authenticated(async()=>{
 try{const {actor,d,staff}=await context();const rows=await d.prepare("SELECT * FROM sk_order_transfers WHERE state='pending' ORDER BY created_at DESC LIMIT 500").all();const visible=[];
 for(const row of rows.results as any[]){const input:SkOrderInput=JSON.parse(row.data),sender=skSender(staff,input.email,input.userName,input.userNameUnique),client=await skClient(d,input.phone),owner=staff.find(e=>e.id===client?.owner),canDecide=skMayDecide(actor,sender,owner);
 if(actor.id!==sender?.id&&!canDecide)continue;
 visible.push({id:row.id,name:client?.name||input.name,at:row.created_at,reason:client?.owner&&client.owner!==sender?.id?'Клиент принадлежит оператору '+(owner?.login||client.owner):row.reason,canDecide,sender:sender?.login||input.userName||input.email});}
 const health=actor.role==='admin'?await d.prepare("SELECT data FROM settings WHERE id='sk-order-health'").first<{data:string}>():null;
 return Response.json({rows:visible,health:health?JSON.parse(health.data):null});
 }catch{return Response.json({error:'Не удалось загрузить заявки СК'},{status:403});}
});
export const POST=authenticated(async req=>{
 try{const {actor,d,staff}=await context(),p=z.object({id:z.string().regex(/^\d+$/),action:z.enum(['approve','reject'])}).parse(await req.json());if(!['approve','reject'].includes(p.action)||!/^\d+$/.test(p.id))throw Error('Некорректное решение');
 const row=await d.prepare("SELECT * FROM sk_order_transfers WHERE id=? AND state='pending'").bind(p.id).first<any>();if(!row)throw Error('Заявка уже обработана');
 const input:SkOrderInput=JSON.parse(row.data),sender=skSender(staff,input.email,input.userName,input.userNameUnique),client=await skClient(d,input.phone),owner=staff.find(e=>e.id===client?.owner);
 if(!skMayDecide(actor,sender,owner))return Response.json({error:'Решение доступно руководителю владельца клиента'},{status:403});
 if(p.action==='approve'){const result=await acceptSkOrder(d,input,actor);if(result.state!=='imported')throw Error(result.reason||'Проверьте ФИО сотрудника СК');return Response.json(result);}
 const event={id:'SK-REJECT-'+p.id,clientId:client?.id||'',orderId:'',at:new Date().toISOString(),actor:actor.name,actorId:actor.id,text:'Отклонена заявка из Скорозвона · звонок '+p.id};
 const results=await d.batch([d.prepare("UPDATE sk_order_transfers SET state='rejected',decided_by=? WHERE id=? AND state='pending'").bind(actor.id,p.id),d.prepare("INSERT OR IGNORE INTO events(id,client_id,order_id,at,data) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sk_order_transfers WHERE id=? AND state='rejected' AND decided_by=?)").bind(event.id,event.clientId,'',event.at,JSON.stringify(event),p.id,actor.id)]);if(!results[0].meta.changes)throw Error('Заявка уже обработана');return Response.json({state:'rejected'});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Ошибка обработки заявки'},{status:400});}
});
