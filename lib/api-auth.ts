import {sharedIncomingClientAccess} from './incoming';
import {readLimitedText,BodyTooLarge} from './request-body';
import {personalAuth,sessionEmployee,trustedOrigin} from './auth';
import {db} from './db';
import {isLogistic} from './crm';
import {acquireOrderAccess,releaseOrderAccess} from './order-access';
import {mayCallEndpoint,seesOrder} from './permissions';
import {usesOrderLease} from './department-orders';
export function authenticated(handler:(req:Request)=>Promise<Response>){
 return async(req:Request):Promise<Response>=>{
  if(!personalAuth())return handler(req);
  let operationLease:{employeeId:string;token:string}|undefined;
  try{
   const employee=await sessionEmployee(req.headers);
   if(!employee)return Response.json({error:'Требуется вход'},{status:401});
   const write=!['GET','HEAD'].includes(req.method);
   if(write&&!trustedOrigin(req.headers))return Response.json({error:'Запрос отклонён'},{status:403});
   const url=new URL(req.url);let body:any;
   if(write){const raw=await readLimitedText(req,6000000);if(raw.length>1500000)throw new BodyTooLarge('Слишком большой запрос');body=JSON.parse(raw);}
   if(!mayCallEndpoint(employee,url,req.method,body))return Response.json({error:'Недостаточно прав'},{status:403});
   if((body?.actorId&&body.actorId!==employee.id)||(url.searchParams.has('actorId')&&url.searchParams.get('actorId')!==employee.id))return Response.json({error:'Нельзя действовать от имени другого сотрудника'},{status:403});
   const crmOrderWrite=url.pathname==='/api/crm'&&['clientWaiting','markPV','courierAccept','courierOutcome','courierWorkflow','receivePayment','saveManualDeliveryCost','returnToWarehouse','markPackingWaybill','updateWaybillComment','selectCdekTariff','updateDelivery','updateOrder','transition','contact','comment','incomingResult'].includes(body?.action);
   const orderId=body?.orderId||url.searchParams.get('orderId')||(crmOrderWrite?body.id:undefined);
   let order;
   if(orderId&&(!crmOrderWrite||['operator','department_head'].includes(employee.role))){
    const row=await db().prepare('SELECT data FROM orders WHERE id=?').bind(orderId).first<{data:string}>();
    const staff=await db().prepare('SELECT data FROM employees').all<{data:string}>();
    if(!row||!seesOrder(employee,JSON.parse(row.data),staff.results.map(x=>JSON.parse(x.data)))&&!((url.pathname==='/api/call-history'&&!write||url.pathname==='/api/telephony'&&req.method==='POST')&&await sharedIncomingClientAccess(db(),employee,JSON.parse(row.data).clientId)))return Response.json({error:'Заказ недоступен'},{status:403});
    order=JSON.parse(row.data);
   }
   if(write&&orderId&&(isLogistic(employee.role)||order&&usesOrderLease(employee,order))&&url.pathname!=='/api/order-access'){
    const token=crypto.randomUUID();
    const access=await acquireOrderAccess(orderId,employee,token,300000);
    if(!access.editable)return Response.json({error:'Заказ сейчас обрабатывает '+(access.holder||'другой логист')+'. Доступен только просмотр.'},{status:409});
    operationLease={employeeId:employee.id,token};
   }
   url.searchParams.set('actorId',employee.id);
   if(body)body.actorId=employee.id;
   const response=await handler(new Request(url,{method:req.method,headers:req.headers,...(write?{body:JSON.stringify(body)}:{})}));
   response.headers.set('Cache-Control','no-store');
   return response;
  }catch(error){return Response.json({error:error instanceof BodyTooLarge?error.message:'Не удалось выполнить запрос'},{status:error instanceof BodyTooLarge?413:400});}
  finally{if(operationLease)await releaseOrderAccess(operationLease.employeeId,operationLease.token).catch(console.error);}
 };
}
