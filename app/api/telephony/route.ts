import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {z} from 'zod';

export const dynamic='force-dynamic';
const input=z.discriminatedUnion('mode',[
 z.object({mode:z.literal('test')}),z.object({mode:z.literal('echo')}),
 z.object({mode:z.literal('client'),clientId:z.string().min(1)}),
 z.object({mode:z.literal('order'),orderId:z.string().min(1)})
]);
function config(){return {username:process.env.CRM_PHONE_USER||'',password:process.env.CRM_PHONE_PASSWORD||'',phone:process.env.CRM_PHONE_TEST_NUMBER||'',callerId:process.env.CRM_PHONE_CALLER_ID||''};}
// shortcut: admin-only pilot; add individual phone accounts before staff rollout.
async function allowed(){const user=await getChatGPTUser();return user?.employee?.role==='admin'&&user.employee.id===process.env.CRM_PHONE_EMPLOYEE;}
export const GET=authenticated(async()=>{
 if(!await allowed())return Response.json({error:'Тест телефонии пока доступен администратору'},{status:403});
 const c=config();return Response.json({configured:!!c.username&&!!c.password,phone:c.phone,callerId:c.callerId,testMode:true,lines:25,cps:5},{headers:{'Cache-Control':'no-store'}});
});
export const POST=authenticated(async(req:Request)=>{
 if(!await allowed())return Response.json({error:'Тест телефонии пока доступен администратору'},{status:403});
 try{
  const p=input.parse(await req.json()),c=config();
  if(!c.username||!c.password||!/^7\d{10}$/.test(c.phone))throw Error('Телефония ещё не подключена');
  let clientId=p.mode==='client'?p.clientId:'';
  if(p.mode==='order'){
   const order=await db().prepare('SELECT client_id FROM orders WHERE id=?').bind(p.orderId).first<{client_id:string}>();
   if(!order)throw Error('Заказ не найден');clientId=order.client_id;
  }
  if(clientId){
   const row=await db().prepare('SELECT phone FROM clients WHERE id=?').bind(clientId).first<{phone:string}>();
   if(!row)throw Error('Клиент не найден');
   let phone=row.phone.replace(/\D/g,'');if(phone.length===11&&phone.startsWith('8'))phone='7'+phone.slice(1);
   if(phone!==c.phone)throw Error('Сейчас разрешён только звонок на согласованный тестовый номер. Звонки клиентам включим после проверки звука.');
  }
  // The PBX independently permits only these two destinations during the pilot.
  return Response.json({username:c.username,password:c.password,destination:p.mode==='echo'?'echo':'test',label:p.mode==='echo'?'Проверка микрофона — эхо':`Тестовый звонок · +${c.phone}`},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Проверьте параметры звонка':e instanceof Error?e.message:'Не удалось подготовить звонок'},{status:400});}
});
