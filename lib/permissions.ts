import {canHandleCourierDoor,canEditRecalledCourierOrder,courierRecalledAtWarehouse} from './courier.ts';
import {isLogistic} from './crm.ts';
import {canLogisticEditOrder,orderEditingLocked,type Employee,type State,type Client,type Order} from './crm.ts';
import {departmentWorkStage,isDepartmentOrder} from './department-orders.ts';
export function canOpenClientCard(e:Pick<Employee,'id'|'role'>,c?:Pick<Client,'owner'>){return !!c&&(e.role!=='operator'||c.owner===e.id);}
export function ownsClient(e:Employee,c:Client,staff:Employee[]){return e.role==='admin'||e.role==='operator'&&c.owner===e.id||e.role==='department_head'&&!!e.department&&staff.some(x=>x.id===c.owner&&x.role==='operator'&&x.department===e.department);}
export function seesOrder(e:Employee,o:Order,staff:Employee[]){
 if(e.role==='admin')return true;
 if(e.role==='courier')return o.delivery==='moscow_courier'&&o.courier?.id===e.id;
 if(e.role==='operator')return o.manager===e.id;
 if(e.role==='department_head')return !!e.department&&staff.some(x=>x.id===o.manager&&x.role==='operator'&&x.department===e.department);
 if(isLogistic(e.role))return true;
 return e.role==='redemption'&&['shipping','pickup','redeemed','returned'].includes(o.status);
}
export function visibleState(s:State,e:Employee):State{
 if(e.role==='admin')return s;
 if(e.role==='courier'){
  const orders=s.orders.filter(o=>seesOrder(e,o,s.employees)).map(o=>({...o,paymentReceipt:undefined,manager:'',logistic:'',paymentReceivedBy:undefined}));
  return {orders,clients:s.clients.filter(c=>orders.some(o=>o.clientId===c.id)).map(c=>({id:c.id,name:c.name,phone:c.phone,city:c.city,address:c.address,source:'',owner:'',assignedUntil:'',createdAt:c.createdAt,version:c.version})),employees:[e],events:[],incoming:[],settings:{retentionDays:0,orderPolicy:s.settings?.orderPolicy}};
 }
 const orders=s.orders.filter(o=>seesOrder(e,o,s.employees));const orderIds=new Set(orders.map(o=>o.id));
 const clients=s.clients.filter(c=>ownsClient(e,c,s.employees)||orders.some(o=>o.clientId===c.id));const ids=new Set(clients.map(c=>c.id));
 const staffIds=new Set([e.id,...orders.flatMap(o=>[o.manager,o.logistic]),...clients.map(c=>c.owner)]);
 const employees=s.employees.filter(x=>staffIds.has(x.id)||isLogistic(e.role)&&x.role==='courier'||e.role==='chief_logistic'&&x.role==='logistic'||e.role==='department_head'&&x.role==='operator'&&!!e.department&&x.department===e.department).map(x=>({...x,salary:x.id===e.id||e.role==='chief_logistic'&&x.role==='logistic'||e.role==='department_head'&&x.role==='operator'&&x.department===e.department?x.salary:0,bonus:x.id===e.id||e.role==='chief_logistic'&&x.role==='logistic'||e.role==='department_head'&&x.role==='operator'&&x.department===e.department?x.bonus:0}));
 const hidePhone=e.role==='operator'||e.role==='department_head';
 return {...s,clients:clients.map(c=>hidePhone?{...c,phone:''}:c),orders:orders.map(o=>{if(isLogistic(e.role))return o;const {paymentReceipt,...rest}=o;return rest;}),employees,events:s.events.filter(x=>ids.has(x.clientId)&&(!x.orderId||orderIds.has(x.orderId))),incoming:(s.incoming||[]).filter(x=>ids.has(x.clientId||''))};
}
export function authorizeCrm(e:Employee,p:any,s:State){
 const allow=(ok:boolean)=>{if(!ok)throw Error('Недостаточно прав для этого действия');};
 if(e.role==='admin')return;
 if(e.role==='courier')return allow(p.action==='readReminder'||['courierOutcome','courierAccept','courierWorkflow','contact'].includes(p.action)&&s.orders.some(o=>o.id===p.id&&seesOrder(e,o,s.employees)));
 if(p.action==='readReminder')return;
 const client=s.clients.find(c=>c.id===(p.clientId||p.id));
 const order=s.orders.find(o=>o.id===p.id);
 if(['settings','import','normalizeImportedAddresses','releaseExpired'].includes(p.action))return allow(false);
 if(p.action==='deleteEmployee')return allow(e.role==='department_head'&&!!e.department);
 if(p.action==='saveEmployee')return allow(e.role==='chief_logistic'||e.role==='department_head'&&!!e.department);
 if(p.action==='createClient')return allow(e.role==='department_head');
 if(p.action==='updateClient')return allow(!!client&&ownsClient(e,client,s.employees));
 if(['createOrder','requestOrder','decideOrderRequest'].includes(p.action))return allow(!!client&&ownsClient(e,client,s.employees)&&(p.action!=='decideOrderRequest'||e.role==='department_head'));
 if(!order||!seesOrder(e,order,s.employees))return allow(false);
 if(e.role==='department_head'){
  allow(isDepartmentOrder(e,order,s.employees)&&departmentWorkStage(order));
  return allow(['transition','contact','comment'].includes(p.action)||p.action==='courierWorkflow'&&['confirm','claimDoor','resolveDoor'].includes(p.operation));
 }
 if(isLogistic(e.role)&&['updateOrder','updateDelivery','updateWaybillComment'].includes(p.action)){
  allow(canLogisticEditOrder(order));
  if(p.action==='updateOrder'){
   allow(p.items===undefined||JSON.stringify(p.items)===JSON.stringify(order.items));
   return;
  }
 }
 if(p.action==='courierWorkflow'&&['claimDoor','resolveDoor'].includes(p.operation))return allow(canHandleCourierDoor(order,e,s.employees));
 allow(!orderEditingLocked(e,order)||p.action==='updateOrder'&&canEditRecalledCourierOrder(order,e));
 if(p.action==='transition'){
  if(e.role==='operator')allow(['confirm','extra','refused'].includes(p.to)||p.to==='packing'&&order.status==='rework'&&courierRecalledAtWarehouse(order));
  if(isLogistic(e.role))allow(!['redeemed','returned'].includes(p.to)||order.delivery==='russian_post'&&['shipping','pickup'].includes(order.status));
  if(e.role==='redemption')allow(['pickup','redeemed','returned'].includes(p.to));
 }
}
export function mayCallEndpoint(e:Employee,url:URL,method:string,p:any){
 const path=url.pathname;if(e.role==='admin')return true;
 if(path==='/api/order-access')return (isLogistic(e.role)||['operator','department_head'].includes(e.role))&&method==='POST';
 if(path==='/api/cash')return ['department_head','chief_logistic'].includes(e.role);
 if(path==='/api/activity')return method==='GET'&&e.role==='department_head'&&!!e.department;
 if(e.role==='courier')return path==='/api/crm'&&(method==='GET'||method==='POST'&&['courierOutcome','courierAccept','courierWorkflow','contact','readReminder'].includes(p?.action));
 if(path==='/api/crm')return true; // Object-level rules are applied inside the CRM handler.
 if(path==='/api/cdek/routing')return method==='GET'&&isLogistic(e.role)&&url.searchParams.has('orderId');
 if(path==='/api/cdek'||path==='/api/cdek/status-mapping')return method==='GET'&&isLogistic(e.role);
 if(path==='/api/callback-phones'||path==='/api/postal-form')return method==='GET'&&isLogistic(e.role);
 if(path==='/api/dadata')return method==='GET'||p?.action==='suggest';
 if(path==='/api/mainsms')return method==='GET'||!['save','check'].includes(p?.action);
 if(path==='/api/warehouse')return isLogistic(e.role)||method==='GET'&&url.searchParams.has('catalog');
 if(path==='/api/warehouse/waybill'||path.startsWith('/api/cdek/'))return isLogistic(e.role);
 return false;
}
