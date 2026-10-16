import {orderDatesForTransition,type Order,type Status} from './crm.ts';
export function cdekStatusPatch(order:Order&{cdekStatus?:{at:string;code:string;revision:string}},entity:any,mapping:Record<string,string>,revision:string):Partial<Order>|null{
 if(entity.is_return||entity.is_reverse||entity.is_client_return)return null;
 const latest=(entity.statuses||[]).filter((s:any)=>!s.deleted&&Number.isFinite(Date.parse(s.date_time))).sort((a:any,b:any)=>Date.parse(b.date_time)-Date.parse(a.date_time))[0];
 const created=(entity.statuses||[]).find((s:any)=>!s.deleted&&s.code==='CREATED'&&Number.isFinite(Date.parse(s.date_time)));
 const transferred=created&&!order.cdekTransferredAt?{cdekTransferredAt:new Date(created.date_time).toISOString()}:{};
 const raw=entity.keep_free_until;
 const storageAt=typeof raw==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)?Date.parse(raw):NaN;
 const storageUntil=Number.isFinite(storageAt)?new Date(storageAt+3*3600000).toISOString().slice(0,10):'';
 const details={...transferred,...(storageUntil&&storageUntil!==order.cdekStorageUntil?{cdekStorageUntil:storageUntil}:{})};
 if(!latest)return Object.keys(details).length?details:null;const at=new Date(latest.date_time).toISOString();
 if(order.cdekStatus&&(Date.parse(at)<Date.parse(order.cdekStatus.at)||at===order.cdekStatus.at&&latest.code===order.cdekStatus.code&&revision===order.cdekStatus.revision))return Object.keys(details).length?details:null;
 const targets:Record<string,Status>={new:'draft',accepted:'check',cancelled:'refused',sent:'shipping',paid:'redeemed',returned:'returned'};
 const status=targets[mapping[latest.code]];
 return {...details,cdekStatus:{code:latest.code,at,revision},...(status&&status!==order.status?{status,warehouseReturnedAt:undefined,...orderDatesForTransition(order,status,at),...(status==='check'&&!order.confirmedAt?{confirmedAt:at}:{}),contact:'none' as const,due:''}:{})};
}
