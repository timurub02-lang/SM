import {assignedClients,departmentOrders,orderGroup,reworkStage,scheduledCalls,type Employee,type State} from './crm.ts';
import {filteredClientList} from './crm-client-list.ts';
import {clientWorkStatus} from './client-work.ts';
import {orderDisplayGroup,orderDisplayGroups,showOrderInList} from './order-premium-stage.ts';
import {eligibleForRedemption} from './redemption-priority.ts';
import {clientRetentionExpiring} from './client-retention-label.ts';

export type WorkspaceSummary={
 mine:{all:number;withoutOrders:number;inTransit:number;expires:number;reworkOrders:number;scheduledCalls:number};
 nav:{check:number;rework:number;incoming:number};
 orders:{all:number;groups:Record<string,number>;eligibleSent:number;nextPremium:number};
 rework:Record<string,number>;
 work:ClientWorkCounts;
 listRevision:string;
};
export type ClientWorkCounts={all:number;needed:number;planned:number;done:number};

export function buildClientWorkCounts(state:State,employee:Employee,query:Parameters<typeof filteredClientList>[2],now=Date.now()):ClientWorkCounts{
 const candidates=filteredClientList(state,employee,{...query,clientWorkFilter:'all'},now),work=new Map((state.clientWork||[]).map(row=>[row.clientId,row]));
 const active=new Set(state.orders.filter(o=>['new','accepted','sent'].includes(orderGroup(o).id)).map(o=>o.clientId));
 const counts={all:candidates.length,needed:0,planned:0,done:0};
 for(const client of candidates){const group=clientWorkStatus(client,work.get(client.id),state.clientReminders||[],now,active.has(client.id)).group;if(group==='needed'||group==='planned'||group==='done')counts[group]++;}
 return counts;
}

// The worker supplies the same permission-filtered, enriched State as the existing context.
export function buildWorkspaceSummary(state:State,employee:Employee,now=Date.now()):WorkspaceSummary{
 const mine=assignedClients(state.clients,state.employees,employee),mineIds=new Set(mine.map(c=>c.id)),clients=new Map(state.clients.map(c=>[c.id,c]));
 const activeClients=new Set<string>(),transitClients=new Set<string>();
 for(const order of state.orders){const group=orderGroup(order).id;if(['new','accepted','sent'].includes(group))activeClients.add(order.clientId);if(group==='sent')transitClients.add(order.clientId);}
 const scoped=employee.role==='operator'?state.orders.filter(o=>o.manager===employee.id):employee.role==='department_head'?departmentOrders(state.orders,state.employees,employee):state.orders;
 const visible=scoped.filter(o=>clients.has(o.clientId)&&showOrderInList(o,clients.get(o.clientId),employee.role));
 const groups=Object.fromEntries(orderDisplayGroups.map(g=>[g.id,0])),rework:Record<string,number>={};
 for(const order of visible)groups[orderDisplayGroup(order).id]++;
 for(const order of scoped.filter(o=>o.status==='rework')){const key=reworkStage(order,now,state.settings.orderPolicy);rework[key]=(rework[key]||0)+1;}
 // Membership, not just totals: simultaneous deadline changes must refresh a filtered list.
 let revision=2166136261;const add=(value:string)=>{for(let i=0;i<value.length;i++)revision=Math.imul(revision^value.charCodeAt(i),16777619);};
 const workMap=new Map((state.clientWork||[]).map(w=>[w.clientId,w])),work:ClientWorkCounts={all:mine.length,needed:0,planned:0,done:0};
 const reminders=new Map<string,NonNullable<State['clientReminders']>>();for(const row of state.clientReminders||[]){const rows=reminders.get(row.clientId)||[];rows.push(row);reminders.set(row.clientId,rows);}
 const day=new Date(now+10800000).toISOString().slice(0,10);add(day);
 for(const client of mine){const group=clientWorkStatus(client,workMap.get(client.id),reminders.get(client.id)||[],now,activeClients.has(client.id)).group;if(group==='needed'||group==='planned'||group==='done')work[group]++;add(client.id+':'+group+':'+Number(clientRetentionExpiring(client,activeClients.has(client.id),now,state.retentionPreview?.[client.id]))+':'+Number(now-Date.parse(client.createdAt)<86400000));}
 for(const order of scoped)add(order.id+':'+(order.status==='rework'?reworkStage(order,now,state.settings.orderPolicy):'')+':'+Number(!!order.due&&Date.parse(order.due)<=now));
 return {
  mine:{all:mine.length,withoutOrders:mine.filter(c=>!activeClients.has(c.id)).length,inTransit:mine.filter(c=>transitClients.has(c.id)).length,expires:mine.filter(c=>clientRetentionExpiring(c,activeClients.has(c.id),now,state.retentionPreview?.[c.id])).length,reworkOrders:state.orders.filter(o=>mineIds.has(o.clientId)&&o.status==='rework').length,scheduledCalls:scheduledCalls(state.orders,employee,state.employees).filter(o=>mineIds.has(o.clientId)).length},
  nav:{check:scoped.filter(o=>o.status==='check'&&clients.has(o.clientId)).length,rework:scoped.filter(o=>o.status==='rework').length,incoming:(state.incoming||[]).filter(i=>!i.closedAt&&!i.spam).length},
  orders:{all:visible.length,groups,eligibleSent:visible.filter(o=>orderGroup(o).id==='sent'&&eligibleForRedemption(o,state.redemptionStatuses||[])).length,nextPremium:visible.filter(o=>!!state.premiumNextPeriod&&o.premiumNextPeriod===state.premiumNextPeriod).length},
  rework,work,listRevision:(revision>>>0).toString(36),
 };
}
