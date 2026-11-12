import {assignedClients,orderGroup,type State,type Employee,type Client,type Order} from './crm.ts';
import {clientRetentionExpiring} from './client-retention-label.ts';
import {clientWorkStatus,clientWorkQueueOrder} from './client-work.ts';
export function filteredClientList(state:State,employee:Employee,{filter,query,clientWorkFilter,timeZone='Europe/Moscow'}:{filter:string;query:string;clientWorkFilter:string;timeZone?:string},reminderNow=Date.now()){
 const day=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});const today=day.format(reminderNow);
 const ordersByClient=new Map<string,Order[]>();for(const o of state.orders){const group=ordersByClient.get(o.clientId)||[];group.push(o);ordersByClient.set(o.clientId,group);}
 const mine=assignedClients(state.clients,state.employees,employee);const clientsWithActiveOrders=new Set(state.orders.filter(o=>["new","accepted","sent"].includes(orderGroup(o).id)).map(o=>o.clientId));const clientsInTransit=new Set(state.orders.filter(o=>orderGroup(o).id==="sent").map(o=>o.clientId));const mineIds=new Set(mine.map(c=>c.id));const myOrders=state.orders.filter(o=>mineIds.has(o.clientId));const active=(o:Order)=>!["redeemed","refused","returned"].includes(o.status);
 const attention=myOrders.filter(o=>o.status==="rework"||(o.due&&Date.parse(o.due)<=reminderNow));
 const todayCalls=myOrders.filter(o=>o.due&&Number.isFinite(Date.parse(o.due))&&day.format(new Date(o.due))===today);
 const latest=(id:string)=>(ordersByClient.get(id)||[]).filter(active).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
 const searching=!!query.trim();
 const textMatches=(c:Client)=>`${c.name} ${c.phone} ${c.city} ${(ordersByClient.get(c.id)||[]).map(o=>o.id).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase());
 const workMap=new Map((state.clientWork||[]).map(w=>[w.clientId,w]));
 const expiresSoon=(c:Client)=>clientRetentionExpiring(c,clientsWithActiveOrders.has(c.id),reminderNow,state.retentionPreview?.[c.id]);
 const clientCandidates=mine.filter(textMatches).filter(c=>{const o=latest(c.id);return searching||filter==="without_orders"&&!clientsWithActiveOrders.has(c.id)||filter==="in_transit"&&clientsInTransit.has(c.id)||filter==="attention"&&attention.some(x=>x.clientId===c.id)||filter==="today"&&todayCalls.some(x=>x.clientId===c.id)||filter==="all"||filter==="new"&&reminderNow-Date.parse(c.createdAt)<86400000||filter==="callback"&&o?.contact==="callback"||filter==="rework"&&o?.status==="rework"||filter==="free"&&!c.owner||filter==="expires"&&expiresSoon(c);});
 const workGroup=(c:Client)=>clientWorkStatus(c,workMap.get(c.id),state.clientReminders||[],reminderNow,clientsWithActiveOrders.has(c.id)).group;
 const showClientWork=employee.role==='operator'&&filter!=='in_transit';
 const clients=clientCandidates.filter(c=>searching||!showClientWork||clientWorkFilter==="all"||workGroup(c)===clientWorkFilter).sort((a,b)=>showClientWork?clientWorkQueueOrder(a,workMap.get(a.id),state.clientReminders||[],reminderNow)-clientWorkQueueOrder(b,workMap.get(b.id),state.clientReminders||[],reminderNow):0);
 return clients;
}
