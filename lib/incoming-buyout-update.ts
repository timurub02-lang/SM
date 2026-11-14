import type {ActivityDb} from './activity-store.ts';
import type {Order,Employee} from './crm.ts';
import {initRedemption,dayOf,validDate} from './redemption.ts';
// The order CAS also checks this version, so the entry and request commit together.
export async function incomingBuyoutUpdate(d:ActivityDb,o:Order,e:Employee,mode:'return'|'date'|'comment',reason:string,incomingId:string,at:string,date=''){
 await initRedemption(d);
 const row=await d.prepare('SELECT data,version FROM redemption_entries WHERE order_id=?').bind(o.id).first() as {data:string;version:number}|null,v=JSON.parse(row?.data||'{}');
 if(mode!=='comment'&&(['returned','delivered','client_delivered'].includes(v.result)||o.cdekStatus?.code==='DELIVERED'))throw Error('Заказ уже вручен или возвращён. Обновите данные');
 const day=dayOf(new Date(at));
 if(mode==='date'&&(!validDate(date)||date<day))throw Error('Укажите корректную дату не раньше сегодня');
 if(mode==='date'&&v.result==='to_return')throw Error('По заказу уже запрошен возврат. Сначала согласуйте его отмену с отделом выкупа');
 const storageExtension=mode==='date'&&!!o.cdekStorageUntil&&date>o.cdekStorageUntil;
 const comment=(storageExtension?'ВНИМАНИЕ: клиент планирует выкуп после срока хранения СДЭК; требуется согласовать продление. ':'')+reason;
 const common={...v,pendingEnrollment:false,updatedAt:at,changedBy:e.name,changeSource:'incoming',sourceIncomingId:incomingId,comments:[...(v.comments||[]),{id:crypto.randomUUID(),text:comment,author:e.name,authorId:e.id,at}]};
 const action=mode==='date'?'date':'refusal',result=mode==='date'?'date':'to_return',resultDate=mode==='date'?date:'';
 const data=mode==='comment'?{...common,changeKind:'incoming_comment'}:{...common,incomingScheduled:false,action,result,resultDate,dateConfirmation:mode==='date'?'pending':null,dateConfirmedBy:null,dateConfirmedById:null,dateConfirmedAt:null,dateVerifiedAt:null,dateVerifiedBy:null,dateVerifiedById:null,author:e.name,authorId:e.id,authorRole:e.role,changeKind:mode==='date'?'incoming_buyout_date':'incoming_return_request',resultSource:'incoming',lastDay:day,storageExtensionRequest:storageExtension?{date,at,incomingId}:null,operatorReturn:v.operatorReturn?{...v.operatorReturn,resolvedAt:at,resolvedBy:e.name,resolvedById:e.id}:undefined,days:{...(v.days||{}),[day]:{action,result,date:resultDate,author:e.name,at}}};
 return {version:row?.version||0,data,storageExtension};
}
