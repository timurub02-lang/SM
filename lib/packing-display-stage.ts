import {packingStage,type Order} from './crm.ts';
import {moscowDate} from './base-distribution.ts';
export function packingDisplayStage(order:Order,now=Date.now()){
 const stage=packingStage(order);
 if(stage!=='dispatched')return stage;
 const at=Date.parse(order.cdekTransferredAt||order.shippedAt||'');
 return Number.isFinite(at)&&moscowDate(new Date(at))===moscowDate(new Date(now))?'dispatched':'in_cdek';
}
