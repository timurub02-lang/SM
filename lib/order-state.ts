import type {ActivityDb} from './activity-store.ts';
import {initCrmReadIndexes} from './crm-read-indexes.ts';
import type {State,Order,Client} from './crm.ts';
import {reconcileClients,reconcileOrderTimers} from './base-retention-store.ts';
import {baseSettingsSchema,initialBaseSettings,type BaseSettings} from './base-policy.ts';
import {defaultOrderPolicy,orderPolicySchema} from './order-policy.ts';
import {applyPremiumStages,nextPremiumPreview,ledgerKey,type PremiumLedger} from './premium-ledger.ts';
import {snapshotOrdersForClientQuery,snapshotOrder} from './snapshot-orders.ts';

export {orderMutationActions} from './order-entity-patch.ts';

export async function readRetentionSales(d:ActivityDb,clients:Client[],config:BaseSettings){
 const owners=[...new Set(clients.map(c=>c.owner).filter(owner=>{const p=config.retention.operators[owner];return p&&p.mode!=='fixed';}))];
 if(!owners.length)return [];
 return (await d.prepare("SELECT client_id AS clientId,json_extract(data,'$.manager') AS manager,json_extract(data,'$.status') AS status,json_extract(data,'$.redeemedAt') AS redeemedAt FROM orders WHERE json_extract(data,'$.status')='redeemed' AND json_extract(data,'$.manager') IN (SELECT value FROM json_each(?))").bind(JSON.stringify(owners)).all()).results;
}

export async function readOrderState(d:ActivityDb,orderId:string,reconcile=true):Promise<State>{
 await initCrmReadIndexes(d);
 const order=await d.prepare('SELECT client_id FROM orders WHERE id=?').bind(orderId).first();
 if(!order)throw Error('Заказ не найден');
 return readClientState(d,order.client_id,reconcile);
}
export async function readClientState(d:ActivityDb,clientId:string,reconcile=true):Promise<State>{
 await initCrmReadIndexes(d);
 const read=async(table:string,where:string,args:unknown[]=[])=> (await d.prepare(`SELECT data,version FROM ${table} ${where}`).bind(...args).all()).results.map((r:{data:string;version:number})=>({...JSON.parse(r.data),version:r.version}));
 const [clients,orders,employees,events,main,policyRow,ledgerRow]=await Promise.all([
  read('clients','WHERE id=?',[clientId]),d.prepare(snapshotOrdersForClientQuery).bind(clientId).all().then((r:any)=>r.results.map(snapshotOrder)),read('employees','ORDER BY id'),
  d.prepare('SELECT data FROM events WHERE client_id=? ORDER BY at DESC').bind(clientId).all(),
  d.prepare("SELECT data FROM settings WHERE id='main'").first(),d.prepare("SELECT data FROM settings WHERE id='order-policy'").first(),
  d.prepare('SELECT data FROM settings WHERE id=?').bind(ledgerKey).first(),
 ]);
 if(clients.length!==1)throw Error('Клиент заказа не найден');
 const state:State={clients,orders,employees,events:events.results.map((r:{data:string})=>JSON.parse(r.data)),settings:{...(main?JSON.parse(main.data):{retentionDays:30}),orderPolicy:orderPolicySchema.parse(policyRow?JSON.parse(policyRow.data).policy:defaultOrderPolicy)}};
 if(reconcile){
  if(await reconcileOrderTimers(d,state.orders,state.events))return readClientState(d,clientId,true);
  const configRow=await d.prepare("SELECT data FROM settings WHERE id='base-settings'").first();
  const config=baseSettingsSchema.parse(configRow?JSON.parse(configRow.data).config:initialBaseSettings());
  // Repeat-sales policy is operator-wide, even when reconciling just one client's orders.
  const sales=await readRetentionSales(d,state.clients,config);
  if(await reconcileClients(d,state.clients,state.orders,sales))return readClientState(d,clientId,false);
 }
 const ledger:PremiumLedger|null=ledgerRow?JSON.parse(ledgerRow.data):null;
 const preview=nextPremiumPreview(ledger,state.orders,state.employees);
 state.premiumActivePeriod=ledger?.activePeriod;state.premiumNextPeriod=preview?.period;
 state.orders=applyPremiumStages(ledger,state.orders,state.employees).map(o=>({...o,premiumNextPeriod:preview?.orderIds.has(o.id)?preview.period:undefined}));
 return state;
}
