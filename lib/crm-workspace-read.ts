import type {ActivityDb} from './activity-store.ts';
import type {Employee,Order,State} from './crm.ts';
import {initCrmReadIndexes} from './crm-read-indexes.ts';
import {initIncoming} from './incoming.ts';
import {snapshotOrdersQuery,snapshotOrder} from './snapshot-orders.ts';
import {canOpenClientCard} from './permissions.ts';
import {defaultOrderPolicy,orderPolicySchema} from './order-policy.ts';
import {applyPremiumStages,nextPremiumPreview,ledgerKey,type PremiumLedger} from './premium-ledger.ts';

export const splitWorkspaceEnabled=(employee?:Employee)=>process.env.CRM_SPLIT_READS==='1'&&!!employee&&['operator','department_head'].includes(employee.role);
const decode=(row:{data:string;version:number})=>({...JSON.parse(row.data),version:row.version});
// These fields are needed only by the independently loaded card, never by list selectors.
const orderProjection="json_remove(o.data,'$.operatorComments','$.comment','$.logisticComment','$.waybillComment')";
const clientProjection="json_remove(data,'$.legacyOrderHistory','$.importFields')";
const orderQuery=(where:string,projection=true)=>snapshotOrdersQuery.replace('o.data',projection?orderProjection+' AS data':'o.data').replace(' ORDER BY o.id DESC',` WHERE ${where} ORDER BY o.id DESC`);

export async function workspaceBootstrap(d:ActivityDb,employee:Employee){
 const [main,policy]=await Promise.all([d.prepare("SELECT data FROM settings WHERE id='main'").first(),d.prepare("SELECT data FROM settings WHERE id='order-policy'").first()]);
 return {clients:[],orders:[],events:[],employees:[employee],settings:{...(main?JSON.parse(main.data):{retentionDays:30}),orderPolicy:orderPolicySchema.parse(policy?JSON.parse(policy.data).policy:defaultOrderPolicy)},historyRemote:true,currentEmployeeId:employee.id,personalAuth:true,splitReads:true} satisfies State&{currentEmployeeId:string;personalAuth:boolean;splitReads:boolean};
}

async function workspaceScope(d:ActivityDb,e:Employee){
 if(!['operator','department_head'].includes(e.role))throw Error('Рабочая область недоступна');
 await initCrmReadIndexes(d);await initIncoming(d);
 const staff:Employee[]=(await d.prepare('SELECT data,version FROM employees ORDER BY id').all()).results.map(decode);
 const owners=e.role==='operator'?[e.id]:staff.filter(x=>x.role==='operator'&&!!e.department&&x.department===e.department).map(x=>x.id);
 const shared:string[]=e.role==='department_head'?(await d.prepare('SELECT DISTINCT client_id FROM incoming_calls WHERE shared_queue=1 AND spam=0 AND closed_at IS NULL AND client_id IS NOT NULL').all()).results.map((r:{client_id:string})=>r.client_id):[];
 const args=[JSON.stringify(owners),JSON.stringify(shared)];
 // UNION lets SQLite use the manager and client indexes before decoding any order JSON.
 const cte=`WITH owners AS (SELECT value AS id FROM json_each(?)),shared AS (SELECT value AS id FROM json_each(?)),
 owned AS (SELECT id FROM clients WHERE json_extract(data,'$.owner') IN (SELECT id FROM owners)),
 allowed_orders AS (SELECT id FROM orders WHERE json_extract(data,'$.manager') IN (SELECT id FROM owners)
 UNION SELECT id FROM orders WHERE client_id IN (SELECT id FROM owned UNION SELECT id FROM shared)),
 allowed_clients AS (SELECT id FROM owned UNION SELECT id FROM shared UNION SELECT client_id FROM orders WHERE id IN (SELECT id FROM allowed_orders)) `;
 return {staff,shared,args,cte};
}

async function premiumStages(d:ActivityDb,state:State){
 const row=await d.prepare('SELECT data FROM settings WHERE id=?').bind(ledgerKey).first();
 const ledger:PremiumLedger|null=row?JSON.parse(row.data):null;
 // Membership uses external IDs across departments; keep the existing financial rule intact.
 // shortcut: global redeemed-order metadata remains until the premium read model replaces this calculation.
 const fields=['id','manager','status','testOnly','priorPremiumPaid','legacyLv','importedPayment','delivery','paymentReceivedAt','paymentReceipt','paymentReceivedAmount','cdekRemittances','cdekHistoryRecovery'];
 const premium:Order[]=ledger?(await d.prepare(`SELECT json_object(${fields.map(key=>`'${key}',json_extract(data,'$.${key}')`).join(',')}) AS data FROM orders WHERE json_extract(data,'$.status')='redeemed' ORDER BY id DESC`).all()).results.map((r:{data:string})=>JSON.parse(r.data)):state.orders;
 const preview=nextPremiumPreview(ledger,premium,state.employees);
 const stages=new Map(applyPremiumStages(ledger,[...premium,...state.orders.filter(o=>o.status!=='redeemed')],state.employees).map(o=>[o.id,o.premiumStage]));
 state.premiumActivePeriod=ledger?.activePeriod;state.premiumNextPeriod=preview?.period;
 state.orders=state.orders.map(o=>({...o,premiumStage:stages.get(o.id),premiumNextPeriod:preview?.orderIds.has(o.id)?preview.period:undefined}));
}

export async function readWorkspaceState(d:ActivityDb,e:Employee,withPremium=true):Promise<State>{
 const {staff,args,cte}=await workspaceScope(d,e);
 const [base,clients,orders]=await Promise.all([
  workspaceBootstrap(d,e),
  d.prepare(cte+`SELECT ${clientProjection} AS data,version FROM clients WHERE id IN (SELECT id FROM allowed_clients) ORDER BY id`).bind(...args).all(),
  d.prepare(cte+orderQuery('o.id IN (SELECT id FROM allowed_orders)')).bind(...args).all(),
 ]);
 const state:State={...base,employees:staff,clients:clients.results.map(decode),orders:orders.results.map(snapshotOrder)};
 if(withPremium)await premiumStages(d,state);
 return state;
}

export async function hydrateWorkspaceOrders(d:ActivityDb,state:State,rows:Order[],e:Employee){
 if(rows.length>50)throw Error('Слишком большая страница');
 const allowed=new Set(state.orders.map(o=>o.id));
 if(rows.some(o=>!allowed.has(o.id)))throw Error('Заказ недоступен');
 const {cte,args}=await workspaceScope(d,e);
 const full:Order[]=(await d.prepare(cte+orderQuery('o.id IN (SELECT id FROM allowed_orders) AND o.id IN (SELECT value FROM json_each(?))',false)).bind(...args,JSON.stringify(rows.map(o=>o.id))).all()).results.map(snapshotOrder);
 const byId=new Map(full.map(o=>[o.id,o]));
 return rows.flatMap(o=>{const found=byId.get(o.id);if(!found)return [];const {paymentReceipt,...rest}=found;return [{...rest,paymentReceivedAmount:paymentReceipt?.amount,premiumStage:o.premiumStage,premiumNextPeriod:o.premiumNextPeriod}];});
}

export async function readWorkspaceCard(d:ActivityDb,e:Employee,type:'client'|'order',id:string):Promise<State|null>{
 const {staff,args,cte}=await workspaceScope(d,e);
 const client=await d.prepare(cte+(type==='client'?'SELECT id FROM clients WHERE id=? AND id IN (SELECT id FROM allowed_clients)':'SELECT client_id AS id FROM orders WHERE id=? AND id IN (SELECT id FROM allowed_orders)')).bind(...args,id).first();
 if(!client)return null;
 const [base,clients,orders,events]=await Promise.all([
  workspaceBootstrap(d,e),
  d.prepare(`SELECT ${clientProjection} AS data,version FROM clients WHERE id=?`).bind(client.id).all(),
  d.prepare(orderQuery('o.client_id=?',false)).bind(client.id).all(),
  d.prepare("SELECT e.data FROM events e WHERE e.client_id=? AND (json_extract(e.data,'$.text') LIKE '%→ Отказ%' OR json_extract(e.data,'$.text') LIKE 'Заказ отменён:%' OR instr(json_extract(e.data,'$.text'),'Отказ у двери подтверждён')>0) ORDER BY e.at DESC,e.id DESC").bind(client.id).all(),
 ]);
 const state:State={...base,employees:staff,clients:clients.results.map(decode),orders:orders.results.map(snapshotOrder),events:events.results.map((r:{data:string})=>JSON.parse(r.data))};
 if(type==='client'&&!canOpenClientCard(e,state.clients[0]))return null;
 await premiumStages(d,state);
 return state;
}
