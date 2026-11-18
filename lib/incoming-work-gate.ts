import type {ActivityDb} from './activity-store.ts';
import type {Employee} from './crm.ts';
import {initIncoming,seesIncoming} from './incoming.ts';
import {incomingIsMissed} from './incoming-status.ts';
import {emptyIncomingWorkGate,incomingWorkApplies,type IncomingWorkGate} from './incoming-work-policy.ts';

const visible=(row:any,e:Employee)=>seesIncoming(row,e,row.assignee_id?[{id:row.assignee_id,role:row.assignee_role,department:row.assignee_department} as Employee]:[]);
export async function readIncomingWorkGate(d:ActivityDb,e:Employee,now=Date.now()):Promise<IncomingWorkGate>{
 const gate=emptyIncomingWorkGate();if(!incomingWorkApplies(e))return gate;
 if(!await d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='incoming_calls'").first())return gate;
 await initIncoming(d);
 const rows=(await d.prepare("SELECT i.*,json_extract(a.data,'$.role') assignee_role,json_extract(a.data,'$.department') assignee_department FROM incoming_calls i LEFT JOIN employees a ON a.id=i.assignee_id WHERE i.closed_at IS NULL AND i.spam=0").all()).results;
 const available=rows.filter((r:any)=>visible(r,e));
 gate.incomingIds=available.filter((r:any)=>!incomingIsMissed({missedUntil:r.missed_until},now)).map((r:any)=>r.id);
 if(!gate.incomingIds.length)return gate;
 gate.clientIds=[...new Set(available.map((r:any)=>r.client_id).filter(Boolean))] as string[];
 gate.orderIds=(await d.prepare('SELECT id FROM orders WHERE client_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(gate.clientIds)).all()).results.map((r:any)=>r.id);
 if(e.role==='operator')gate.skOrders=(await d.prepare("SELECT id,client_id clientId FROM orders WHERE json_extract(data,'$.manager')=? AND json_extract(data,'$.status')='draft' AND COALESCE(json_extract(data,'$.skLeadId'),'')<>''").bind(e.id).all()).results as IncomingWorkGate['skOrders'];
 return gate;
}
const incomingActions=new Set(['missIncoming','closeIncoming','incomingResult','createIncomingClient','linkIncomingClient','transferIncoming','assignIncoming','createOrder','incomingBuyoutInfo','requestShipmentReturn','requestShipmentChange','requestOrderCancellation','requestOrderEdit']);
const orderActions=new Set(['saveOrder','confirmByHead','selectOrderPickupPoint','reportPostalBuyout','keepPostalSent','updateMoscowDetails','updateRecipientName','resolveOrderCancellation','resolveOrderEdit','completeOrderEdit','resolveShipmentRequest','clientWaiting','markPV','courierWorkflow','receivePayment','savePostalTracking','saveManualDeliveryCost','returnToWarehouse','markPackingWaybill','updateWaybillComment','selectCdekTariff','updateDelivery','updateOrder','transition','contact','comment']);
const skActions=new Set(['updateOrder','updateRecipientName','updateDelivery','selectOrderPickupPoint','selectCdekTariff','saveManualDeliveryCost','comment']);
export async function incomingWorkRequestAllowed(d:ActivityDb,e:Employee,url:URL,method:string,p:any,gate?:IncomingWorkGate){
 const path=url.pathname,write=!['GET','HEAD'].includes(method);
 if(!write&&['/api/crm','/api/incoming-work-gate','/api/crm/changes','/api/operator-state','/api/telephony','/api/dadata','/api/crm/history','/api/call-history','/api/call-history/recording'].includes(path))return true;
 const g=gate||await readIncomingWorkGate(d,e);if(!g.incomingIds.length)return true;
 const value=(key:string)=>typeof p?.[key]==='string'?p[key]:url.searchParams.get(key)||'';
 const incomingId=value('incomingId'),orderId=value('orderId')||((path==='/api/crm'&&orderActions.has(p?.action)||path==='/api/redemption')?value('id'):''),clientId=value('clientId');
 // Incoming handlers validate the supplied ID, visibility and client/order linkage themselves.
 const incoming=!!incomingId;
 const linkedOrder=g.orderIds.includes(orderId),sk=g.skOrders.some(o=>o.id===orderId),linkedClient=g.clientIds.includes(clientId);
 if(path==='/api/call-history'&&write){
  const masked=url.searchParams.get('masked')==='1',call=await d.prepare(masked?'SELECT order_id,NULL AS client_id FROM replacement_calls WHERE id=?':'SELECT order_id,client_id FROM phone_calls WHERE id=?').bind(value('id')).first() as {order_id:string;client_id:string}|null;
  return !!call&&(g.orderIds.includes(call.order_id)||g.skOrders.some(o=>o.id===call.order_id)||g.clientIds.includes(call.client_id));
 }

 if(!write){
  if(['/api/incoming-clients','/api/incoming-order-client'].includes(path))return incoming;
  if(path==='/api/warehouse'&&url.searchParams.has('catalog'))return true;
  if(path==='/api/redemption')return linkedOrder;
  return linkedOrder||sk;
 }
 if(path==='/api/telephony'&&method==='PATCH'||path==='/api/order-access'&&p?.action==='release'||path==='/api/operator-state'&&['break','finish'].includes(p?.action))return true;
 if(path==='/api/telephony')return p?.mode==='incoming'?incoming:p?.mode==='order'?linkedOrder||sk:p?.mode==='client'?linkedClient:false;
 if(path==='/api/order-access')return linkedOrder||sk;
 if(path==='/api/dadata'&&p?.action==='suggest')return true;
 if(path==='/api/crm'){
  if(incomingActions.has(p?.action))return incoming;
  if(p?.action==='updateClient')return g.clientIds.includes(value('id'));
  if(!orderActions.has(p?.action))return false;
  if(linkedOrder)return true;
  if(!sk)return false;
  if(p.action==='saveOrder')return Array.isArray(p.changes)&&p.changes.length>0&&p.changes.every((c:any)=>skActions.has(c.action));
  return skActions.has(p.action)||p.action==='transition'&&p.to==='confirm';
 }
 if(path==='/api/redemption')return linkedOrder;
 if(['/api/mainsms','/api/cdek/calculate','/api/cdek/pickup-points'].includes(path))return linkedOrder||sk;
 return false;
}
