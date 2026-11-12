import assert from 'node:assert/strict';
import {orderSavePatch,mergeOrderSavePatch,orderPatchActions} from '../lib/order-save-patch.ts';
const before={orders:[{id:'a',clientId:'c',version:1},{id:'b',clientId:'d',version:1}],clients:[{id:'c',version:1},{id:'d',version:1}],events:[{id:'old',orderId:'b',at:'2026-01-01'}],employees:[],settings:{retentionDays:30}};
const after={...before,orders:[{...before.orders[0],version:2,status:'packing'},{...before.orders[1],premiumStage:{status:'paid'}}],clients:[{...before.clients[0],version:2},before.clients[1]],events:[{id:'new',orderId:'a',at:'2026-01-02'},...before.events],tasks:[{id:'new-task'}]};
const patch=orderSavePatch(before,after,'a');
assert.equal(patch.clients.length,1);assert.equal(patch.events.length,1);assert.equal(patch.orders.length,2,'Derived changes without version bump are included');
assert.deepEqual(mergeOrderSavePatch(before,patch),after);
assert.deepEqual(mergeOrderSavePatch(after,patch),after,'Repeated response does not duplicate history');
assert.equal(mergeOrderSavePatch(before,patch).clients[1],before.clients[1],'Unchanged objects retain identity');
assert(!orderPatchActions.has('deleteEmployee'));assert(!orderPatchActions.has('import'));
// Reconciliation and another writer can change records beyond the edited order.
const reconciled={...after,
 orders:[...after.orders,{id:'concurrent',clientId:'concurrent-client',version:1}],
 clients:[after.clients[0],{...after.clients[1],version:2,owner:''},{id:'concurrent-client',version:1}],
 events:[{id:'release',clientId:'d',orderId:'',at:'2026-01-04'},{id:'concurrent-event',orderId:'concurrent',at:'2026-01-03'},...after.events],
 tasks:[],reminders:[{id:'resolved',resolved:true}],incoming:[],clientWork:[],
 settings:{retentionDays:31},employees:[{id:'admin',role:'admin'}],
};
const reconciledPatch=orderSavePatch(before,reconciled,'a');
assert(reconciledPatch.clients.some(c=>c.id==='d'&&c.owner===''),'Unrelated retention changes are included');
assert(reconciledPatch.events.some(e=>e.id==='release'),'Client-only events are included');
assert.deepEqual(mergeOrderSavePatch(before,reconciledPatch),reconciled,'Patch replaces side data and includes concurrent records');
assert.deepEqual(mergeOrderSavePatch(reconciled,reconciledPatch),reconciled,'Repeated responses are idempotent');
const selected=orderSavePatch(reconciled,reconciled,'a');
assert.deepEqual(selected.orders.map(o=>o.id),['a']);
assert.deepEqual(selected.clients.map(c=>c.id),['c']);
assert.deepEqual(selected.events.map(e=>e.id),['new'],'The edited order keeps its history even when unchanged');
console.log('Order save patches preserve other records, derived fields, history and unrelated screen state');
