import assert from 'node:assert/strict';
import {seed} from '../lib/crm.ts';
import {compactCrmState} from '../lib/compact-crm-state.ts';
import {cancellationDetails} from '../lib/order-cancellation.ts';
const order={id:'o',status:'refused',reason:''};
const state={...seed(),clients:[{id:'c',name:'Client',legacyOrderHistory:[{externalId:'old'}],importFields:{raw:'private'}}],orders:[order],events:[{id:'new',orderId:'o',text:'→ Отказ · причина',at:'2026-11-12T01:00:00Z',actor:'Newest'},{id:'old',orderId:'o',text:'Заказ отменён: старое',at:'2026-11-11T01:00:00Z',actor:'Older'},{id:'other',orderId:'x',text:'Note'}]};
const small=compactCrmState(state);
assert.deepEqual(cancellationDetails(order,small.events),cancellationDetails(order,state.events));
assert.deepEqual(small.clients,[{id:'c',name:'Client'}]);assert.equal(small.events.length,1);assert.equal(state.clients[0].legacyOrderHistory.length,1);
console.log('Compact state: deferred histories, cancellation fallback and source immutability passed');

const imported={...state,clients:[{...state.clients[0],baseImport:{sourceRows:[{raw:'Synthetic audit '.repeat(2000)}]}}],orders:[{...order,legacyLv:{orderId:'source-id',status:'paid',sourceTotal:500,sourceItems:[{raw:'Synthetic source basket '.repeat(2000)}]},items:[{name:'Working basket',quantity:1,price:500}],paymentReceipt:{amount:500}}]};
const projected=compactCrmState(imported);
assert.equal(projected.clients[0].baseImport,undefined);assert.equal(projected.orders[0].legacyLv.sourceItems,undefined);
assert.equal(projected.orders[0].legacyLv.orderId,'source-id');assert.equal(projected.orders[0].legacyLv.sourceTotal,500);
assert.deepEqual(projected.orders[0].items,imported.orders[0].items);assert.deepEqual(projected.orders[0].paymentReceipt,imported.orders[0].paymentReceipt);
assert.ok(imported.clients[0].baseImport.sourceRows.length&&imported.orders[0].legacyLv.sourceItems.length,'Source data must remain untouched');
assert.ok(JSON.stringify(projected).length<JSON.stringify(imported).length/10,'Audit payload must not enter the browser snapshot');
console.log('Raw import audit omitted without changing working basket, legacy references, money or source data');
