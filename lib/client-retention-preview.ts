import {applyRetention,hasActiveOrder,type Client,type Order} from './crm.ts';
import {previousThreeMonths,repeatSales,retentionDays} from './base-distribution.ts';
import type {BaseSettings} from './base-policy.ts';
export type RetentionPreview={until?:string;expiresAfterPremium?:boolean};

// Preview only: reuse the release rules without applying the returned client changes.
export function clientRetentionPreview(clients:Client[],orders:Order[],config:BaseSettings,now=Date.now(),salesOrders:Parameters<typeof repeatSales>[0]=orders){
 const period=config.retention.from&&config.retention.to?config.retention:previousThreeMonths(new Date(now));
 const sales=repeatSales(salesOrders,period.from,period.to),byClient=new Map<string,Order[]>();
 for(const o of orders){const list=byClient.get(o.clientId)||[];list.push(o);byClient.set(o.clientId,list);}
 const result:Record<string,RetentionPreview>={};
 for(const c of clients){
  const related=byClient.get(c.id)||[];
  if(!c.owner||hasActiveOrder(related,c.id)||!related.some(o=>o.manager===c.owner&&o.status==='redeemed'&&o.premiumStage?.status!=='paid'))continue;
  const policy=config.retention.operators[c.owner];
  const preview=applyRetention(c,related,now,retentionDays(policy,sales[c.owner]?.percent),!!policy,false);
  result[c.id]=!preview.owner?{expiresAfterPremium:true}:preview.assignedUntil?{until:preview.assignedUntil}:{};
 }
 return result;
}
