import type {ActivityDb} from './activity-store.ts';
import type {Employee,State} from './crm.ts';
import {canCreateRedemptionStaff} from './crm.ts';
import {visibleState,hideClientNumbers} from './permissions.ts';
import {baseSettingsSchema,initialBaseSettings} from './base-policy.ts';
import {clientRetentionPreview} from './client-retention-preview.ts';
import {readRetentionSales} from './order-state.ts';
import {readIncoming,initIncoming} from './incoming.ts';
import {personalClientReminders} from './client-reminders.ts';
import {readClientWork,initClientWork} from './client-work-store.ts';
import {initPhone} from './phone-store.ts';
import {redemptionConfig,initRedemption} from './redemption.ts';
import {readRedemptionSummaries} from './redemption-summary.ts';

export async function initWorkspaceContext(d:ActivityDb){await initIncoming(d);await initClientWork(d);await initPhone(d);await initRedemption(d);}

export async function buildWorkspaceContext(d:ActivityDb,employee:Employee,state:State,now=Date.now()):Promise<State&{currentEmployeeId:string;personalAuth:boolean}>{
 const visible=visibleState(state,employee);
 const saved=await d.prepare("SELECT data FROM settings WHERE id='base-settings'").first();
 const config=baseSettingsSchema.parse(saved?JSON.parse(saved.data).config:initialBaseSettings());
 visible.retentionPreview=clientRetentionPreview(visible.clients,state.orders,config,now,await readRetentionSales(d,state.clients,config));
 if(employee.role==='department_head'||canCreateRedemptionStaff(employee)){
  const accounts=(await d.prepare('SELECT employee_id,enabled FROM auth_accounts').all()).results;
  visible.employees=visible.employees.map(e=>{const account=accounts.find((a:{employee_id:string;enabled:number})=>a.employee_id===e.id);return {...e,hasPassword:!!account,accessEnabled:!!account?.enabled};});
 }
 const incoming=await readIncoming(d,employee,state.employees,state.orders,true);
 if(employee.role==='department_head'){
  const sharedIds=new Set(incoming.filter(i=>!i.closedAt&&i.clientId&&i.sharedQueue).map(i=>i.clientId));
  visible.clients.push(...state.clients.filter(c=>sharedIds.has(c.id)&&!visible.clients.some(v=>v.id===c.id)).map(hideClientNumbers));
  visible.orders.push(...state.orders.filter(o=>sharedIds.has(o.clientId)&&!visible.orders.some(v=>v.id===o.id)).map(({paymentReceipt,...o})=>o));
  visible.events.push(...state.events.filter(e=>sharedIds.has(e.clientId)&&!visible.events.some(v=>v.id===e.id)));
 }
 return {...visible,redemptionResults:await readRedemptionSummaries(d,visible.orders.map(o=>o.id),new Date(now)),redemptionStatuses:(await redemptionConfig(d)).statuses,incoming,incomingOperators:employee.role==='department_head'?state.employees.filter(e=>e.role==='operator').map(({id,name,department,login})=>({id,name,department,login})):[],clientReminders:await personalClientReminders(d,state,employee),clientWork:await readClientWork(d,employee),currentEmployeeId:employee.id,personalAuth:true};
}
