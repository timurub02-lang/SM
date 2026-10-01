import {personalAuth,sessionEmployee,trustedOrigin} from './auth';
import {db} from './db';
import {mayCallEndpoint,seesOrder} from './permissions';
export function authenticated(handler:(req:Request)=>Promise<Response>){
 return async(req:Request):Promise<Response>=>{
  if(!personalAuth())return handler(req);
  try{
   const employee=await sessionEmployee(req.headers);
   if(!employee)return Response.json({error:'Требуется вход'},{status:401});
   const write=!['GET','HEAD'].includes(req.method);
   if(write&&!trustedOrigin(req.headers))return Response.json({error:'Запрос отклонён'},{status:403});
   const url=new URL(req.url);let body:any;
   if(write){const raw=await req.text();if(raw.length>1500000)return Response.json({error:'Слишком большой запрос'},{status:413});body=JSON.parse(raw);}
   if(!mayCallEndpoint(employee,url,req.method,body))return Response.json({error:'Недостаточно прав'},{status:403});
   if((body?.actorId&&body.actorId!==employee.id)||(url.searchParams.has('actorId')&&url.searchParams.get('actorId')!==employee.id))return Response.json({error:'Нельзя действовать от имени другого сотрудника'},{status:403});
   const orderId=body?.orderId||url.searchParams.get('orderId');
   if(orderId){
    const row=await db().prepare('SELECT data FROM orders WHERE id=?').bind(orderId).first<{data:string}>();
    const staff=await db().prepare('SELECT data FROM employees').all<{data:string}>();
    if(!row||!seesOrder(employee,JSON.parse(row.data),staff.results.map(x=>JSON.parse(x.data))))return Response.json({error:'Заказ недоступен'},{status:403});
   }
   url.searchParams.set('actorId',employee.id);
   if(body)body.actorId=employee.id;
   const response=await handler(new Request(url,{method:req.method,headers:req.headers,...(write?{body:JSON.stringify(body)}:{})}));
   response.headers.set('Cache-Control','no-store');
   return response;
  }catch{return Response.json({error:'Не удалось выполнить запрос'},{status:400});}
 };
}
