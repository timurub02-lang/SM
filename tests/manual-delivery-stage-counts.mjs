import assert from 'node:assert/strict';
import {manualDeliveryStageCounts} from '../lib/packing-display-stage.ts';
const now=Date.parse('2026-11-13T12:00:00Z');
const orders=[{paymentReceivedAt:'2026-11-12T21:05:00Z'},{paymentReceivedAt:'2026-11-12T20:59:59Z'},{paymentReceivedAt:'bad'},{importedPayment:{recordedAt:'2026-11-13T12:00:00Z'}},{priorPremiumPaid:{at:'2026-11-13T12:00:00Z',paymentAccepted:true}}];
assert.deepEqual(manualDeliveryStageCounts(orders,'payment_received',now),{today:1,total:5});
assert.deepEqual(manualDeliveryStageCounts([{warehouseReturnedAt:'2026-11-12T21:00:00Z'},{warehouseReturnedAt:'2026-11-12T20:00:00Z'},{}],'warehouse_returned',now),{today:1,total:3});
assert.deepEqual(manualDeliveryStageCounts([],'payment_received',now),{today:0,total:0});
console.log('Manual stage counters: Moscow midnight, actual acceptance/warehouse dates, historical exclusion and empty totals passed');
