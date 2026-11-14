import type {Order,Employee} from './crm.ts';
export type ShipmentRequest={id:string;kind:'return'|'change';status:'pending'|'done'|'failed';reason:string;incomingId:string;by:string;name:string;at:string;decidedAt?:string;decidedBy?:string;decidedName?:string;decisionReason?:string};
export function shippedOrder(o:Order){return !['redeemed','refused','returned'].includes(o.status)&&!!(o.shippedAt||o.cdekTransferredAt||o.courier||['shipping','pickup'].includes(o.status));}
export function requestShipment(o:Order,e:Employee,kind:ShipmentRequest['kind'],reason:string,incomingId:string,id:string,at:string):Order{
 if(!['admin','operator','department_head'].includes(e.role)||!shippedOrder(o))throw Error('Запрос доступен в отправленном заказе из входящего');
 if(!['cdek_pickup','cdek_courier','moscow_courier','russian_post'].includes(o.delivery||''))throw Error('У заказа не указан перевозчик');
 const key=kind==='return'?'shipmentReturn':'shipmentChange';if(o[key]?.status==='pending')throw Error('Запрос уже передан ответственному сотруднику');
 return {...o,[key]:{id,kind,status:'pending',reason,incomingId,by:e.id,name:e.name,at}};
}
export function resolveShipment(o:Order,e:Employee,kind:ShipmentRequest['kind'],id:string,decision:'done'|'failed',reason:string,at:string):Order{
 const key=kind==='return'?'shipmentReturn':'shipmentChange',r=o[key];
 if(!r||r.id!==id||r.status!=='pending')throw Error('Запрос уже обработан');
 const cdekReturn=kind==='return'&&o.delivery?.startsWith('cdek_');
 if(!(['admin'].includes(e.role)||(cdekReturn?e.role==='redemption':['logistic','chief_logistic'].includes(e.role))))throw Error('Решение принимает ответственный за перевозчика');
 if(!reason.trim())throw Error('Укажите результат обращения к перевозчику');
 return {...o,[key]:{...r,status:decision,decidedAt:at,decidedBy:e.id,decidedName:e.name,decisionReason:reason}};
}
