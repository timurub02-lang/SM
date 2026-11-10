import type {Order} from './crm.ts';
export type ClientOrderHistoryEntry={externalId:string;source:'LV';status:'paid'|'returned';createdAt:string;completedAt?:string;amount:number;items:{name:string;quantity?:number}[];importedAt:string};
export function clientHistoryEntries(history:ClientOrderHistoryEntry[],orders:Order[]){
 const existing=new Set(orders.flatMap(o=>[o.id,o.legacyLv?.orderId].filter(Boolean)));
 return history.filter(h=>!existing.has(h.externalId)&&!existing.has('LV-'+h.externalId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
