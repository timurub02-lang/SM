import type {Order} from './crm.ts';
export function courierStage(o:Order){
 if(!o.courier||o.delivery!=='moscow_courier')return 'none';
 if(o.status==='redeemed')return o.paymentReceivedAt?'settled':'money';
 if(o.status==='returned')return o.warehouseReturnedAt?'settled':'return';
 return ['shipping','pickup'].includes(o.status)?(o.courier.acceptedAt?'delivery':'pending'):'none';
}
export function courierBalance(orders:Order[],id:string){
 let parcels=0,cash=0,pending=0;
 for(const o of orders){if(o.courier?.id!==id)continue;const stage=courierStage(o),amount=Math.round(o.courier.amount*100);if(stage==='delivery'||stage==='return')parcels+=amount;if(stage==='money')cash+=amount;if(stage==='pending')pending+=amount;}
 return {pending:pending/100,parcels:parcels/100,cash:cash/100,total:(parcels+cash)/100};
}
export const courierOutstanding=(o:Order)=>['pending','delivery','return','money'].includes(courierStage(o));
