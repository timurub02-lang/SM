import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {cashInput,hasCash} from '@/lib/cash';
import {initCash} from '@/lib/cash-db';
import {type Employee} from '@/lib/crm';
import {z} from 'zod';
export const dynamic='force-dynamic';
async function employee(id:string){const row=await db().prepare('SELECT data FROM employees WHERE id=?').bind(id).first<{data:string}>();return row?JSON.parse(row.data) as Employee:null;}
async function handle(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 try{
  const p:any=req.method==='GET'?null:await req.json();
  const actor=await employee(p?.actorId||new URL(req.url).searchParams.get('actorId')||'');
  if(!actor||!hasCash(actor.role))return Response.json({error:'Касса недоступна'},{status:403});
  await initCash();const d=db();
  const query=new URL(req.url).searchParams;
  if(query.has('employeeId')||query.get('scope')==='all'){
   if(actor.role!=='admin'||req.method!=='GET')return Response.json({error:'Просмотр касс сотрудников доступен только администратору'},{status:403});
   if(query.get('scope')==='all'){
    const rows=await d.prepare("SELECT e.id,json_extract(e.data,'$.name') AS name,json_extract(e.data,'$.login') AS login,json_extract(e.data,'$.role') AS role,COALESCE(b.balance,0) AS balance,COALESCE((SELECT SUM(amount) FROM cash_operations WHERE recipient=e.id AND kind='transfer' AND accepted_at IS NULL),0) AS pending FROM employees e LEFT JOIN cash_balances b ON b.employee=e.id WHERE json_extract(e.data,'$.role') IN ('admin','department_head','chief_logistic') ORDER BY name,e.id").all();
    return Response.json({accounts:rows.results},{headers:{'Cache-Control':'no-store'}});
   }
   const target=await employee(query.get('employeeId')||'');
   if(!target)return Response.json({error:'Сотрудник не найден'},{status:404});
   const rows=await d.prepare('SELECT * FROM cash_operations WHERE sender=? OR recipient=? ORDER BY created_at DESC,id DESC').bind(target.id,target.id).all();
   return Response.json({operations:rows.results},{headers:{'Cache-Control':'no-store'}});
  }

  if(p){
   if(p.action==='accept'){
    const id=z.string().uuid().parse(p.id);
    const row=await d.prepare("SELECT recipient,accepted_at FROM cash_operations WHERE id=? AND kind='transfer'").bind(id).first<{recipient:string;accepted_at:string|null}>();
    if(!row||row.recipient!==actor.id)throw Error('Перевод недоступен');
    await d.prepare('UPDATE cash_operations SET accepted_at=? WHERE id=? AND recipient=? AND accepted_at IS NULL').bind(new Date().toISOString(),id,actor.id).run();
   }else if(p.action==='create'){
    const input=cashInput.parse(p.operation);const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});
    if(input.date>today)throw Error('Дата операции не может быть в будущем');
    if(input.kind==='spend'&&input.purpose!=='Зарплата')throw Error('Выберите назначение платежа');
    if(input.kind==='transfer'&&input.purpose!=='Перевод другому сотруднику')throw Error('Выберите назначение платежа');
    const recipient=input.kind==='transfer'?await employee(input.recipient||''):input.kind==='add'?actor:null;
    if(input.kind==='transfer'&&(!recipient||!hasCash(recipient.role)||recipient.id===actor.id||recipient.accessEnabled===false))throw Error('Выберите другого сотрудника с кассой');
    const sender=input.kind==='add'?null:actor;const now=new Date().toISOString();
    const old=await d.prepare('SELECT * FROM cash_operations WHERE id=?').bind(input.id).first<any>();
    if(old){if(old.actor!==actor.id||old.kind!==input.kind||old.amount!==input.amount||old.purpose!==input.purpose||old.date!==input.date||old.recipient!==(recipient?.id||null))throw Error('Операция уже сохранена с другими данными');}
    else await d.prepare('INSERT INTO cash_operations(id,kind,sender,recipient,amount,purpose,date,created_at,accepted_at,actor,sender_name,recipient_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(input.id,input.kind,sender?.id||null,recipient?.id||null,input.amount,input.purpose,input.date,now,input.kind==='transfer'?null:now,actor.id,sender?.name||'',recipient?.name||'').run();
   }else throw Error('Неизвестная операция');
  }
  const balance=await d.prepare('SELECT balance FROM cash_balances WHERE employee=?').bind(actor.id).first<{balance:number}>();
  const rows=await d.prepare('SELECT * FROM cash_operations WHERE sender=? OR recipient=? ORDER BY created_at DESC,id DESC').bind(actor.id,actor.id).all();
  const staff=await d.prepare("SELECT id,data FROM employees WHERE json_extract(data,'$.role') IN ('admin','department_head','chief_logistic') ORDER BY id").all<{id:string;data:string}>();
  return Response.json({balance:balance?.balance||0,operations:rows.results,recipients:staff.results.map(r=>JSON.parse(r.data) as Employee).filter(e=>e.id!==actor.id&&e.accessEnabled!==false).map(e=>({id:e.id,name:e.name,login:e.login}))},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof z.ZodError?e.issues.map(i=>i.message).join('; '):e instanceof Error?e.message:'Не удалось сохранить операцию'},{status:400});}
}
export const GET=authenticated(handle);
export const POST=authenticated(handle);
