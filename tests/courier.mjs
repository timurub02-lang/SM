import assert from 'node:assert/strict';
import {courierBalance,courierStage} from '../lib/courier.ts';
const parcel={id:'order',delivery:'moscow_courier',status:'shipping',courier:{id:'courier',name:'Test',assignedAt:'2026-10-02',acceptedAt:'2026-10-02',amount:10000}};
assert.deepEqual(courierBalance([parcel],'courier'),{pending:0,parcels:10000,cash:0,total:10000});
const paid={...parcel,status:'redeemed'};
assert.deepEqual(courierBalance([paid],'courier'),{pending:0,parcels:0,cash:10000,total:10000});
assert.equal(courierStage({...paid,paymentReceivedAt:'2026-10-02'}),'settled');
assert.equal(courierBalance([{...paid,paymentReceivedAt:'2026-10-02'}],'courier').total,0);
const returned={...parcel,status:'returned'};
assert.equal(courierBalance([returned],'courier').parcels,10000);
assert.equal(courierBalance([{...returned,warehouseReturnedAt:'2026-10-02'}],'courier').total,0);
assert.equal(courierBalance([parcel,paid,returned],'other').total,0);
assert.equal(courierBalance([{...parcel,items:[{quantity:1,price:999}]}],'courier').total,10000);
console.log('Courier parcels, cash, returns, settlement, immutable amount and scope passed.');

const pending={...parcel,courier:{...parcel.courier,acceptedAt:undefined}};
assert.equal(courierStage(pending),'pending');
assert.deepEqual(courierBalance([pending],'courier'),{pending:10000,parcels:0,cash:0,total:0});
