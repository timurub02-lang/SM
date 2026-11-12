import type {ActivityDb} from './activity-store.ts';
import type {State} from './crm.ts';
import {workingClientsQuery} from './base-storage.ts';
import {reconcileOrderTimers,reconcileClients} from './base-retention-store.ts';
import {maintainReminders} from './reminder-maintenance.ts';
import {defaultOrderPolicy,orderPolicySchema} from './order-policy.ts';

export async function maintenanceHealthy(d:ActivityDb,now=Date.now()){
 const row=await d.prepare("SELECT data FROM settings WHERE id='crm-maintenance-health'").first();
 if(!row)return false;
 try{const health=JSON.parse(row.data);return health.ok===true&&now-Date.parse(health.at)>=0&&now-Date.parse(health.at)<30000;}catch{return false;}
}

export async function runCrmMaintenance(d:ActivityDb){
 const read=async(table:string)=>(await d.prepare(`SELECT data,version FROM ${table} ORDER BY id`).all()).results.map((r:{data:string;version:number})=>({...JSON.parse(r.data),version:r.version}));
 const readClients=async()=>(await d.prepare(workingClientsQuery).bind('').all()).results.map((r:{data:string;version:number})=>({...JSON.parse(r.data),version:r.version}));
 const policy=await d.prepare("SELECT data FROM settings WHERE id='order-policy'").first();
 const main=await d.prepare("SELECT data FROM settings WHERE id='main'").first();
 const state:State={orders:await read('orders'),clients:await readClients(),employees:await read('employees'),events:(await d.prepare("SELECT data FROM events WHERE data LIKE '%Возврат оператору%' ORDER BY at DESC").all()).results.map((r:{data:string})=>JSON.parse(r.data)),settings:{...(main?JSON.parse(main.data):{retentionDays:30}),orderPolicy:orderPolicySchema.parse(policy?JSON.parse(policy.data).policy:defaultOrderPolicy)}};
 const ordersChanged=await reconcileOrderTimers(d,state.orders,state.events);
 if(ordersChanged)state.orders=await read('orders');
 const clientsChanged=await reconcileClients(d,state.clients,state.orders);
 if(clientsChanged)state.clients=await readClients();
 await maintainReminders(d,state);
 return {ordersChanged,clientsChanged};
}
