import assert from 'node:assert/strict';
import {shipmentStats,shipmentDay} from '../lib/shipment-stats.ts';
const employees=[{id:'a',login:'one',role:'operator',department:'1'},{id:'b',login:'two',role:'operator',department:'2'}];
const order=(id,extra={})=>({id,manager:'a',createdAt:'2026-10-01',shippedAt:'2026-11-15T21:00:00Z',delivery:'russian_post',status:'shipping',items:[],...extra});
const orders=[order('1'),order('2',{status:'redeemed',redeemedAt:'2026-12-01'}),order('3',{status:'returned'}),order('4',{delivery:'moscow_courier'}),order('5',{delivery:'cdek_pickup',cdekTransferredAt:'2026-11-15T21:00:00Z',cdekAcceptedAt:'2026-11-17T10:00:00Z',shippedAt:'2026-11-14'}),order('other',{manager:'b'}),order('old',{shippedAt:'2026-11-15T20:59:59Z'}),order('future',{shippedAt:'2026-11-16T21:00:00Z'}),order('missing',{shippedAt:undefined,status:'redeemed'}),order('bad',{shippedAt:'bad'}),order('test',{testOnly:true}),order('legacy',{legacyLv:{orderId:'LV'},status:'redeemed'})];
orders.push({...orders[0]});
const state={employees,orders};
const rows=shipmentStats(state,{role:'admin'},'2026-11-16','2026-11-16');
assert.deepEqual(rows.map(r=>[r.sentCdek,r.sentPost,r.sentMoscow,r.sent,r.redeemed]),[[1,4,1,6,2],[0,1,0,1,0]]);
assert.equal(shipmentStats(state,{role:'department_head',department:'1'},'2026-11-16','2026-11-16').length,1);
assert.equal(shipmentStats(state,employees[1],'2026-11-16','2026-11-16')[0].sent,1);
assert.equal(shipmentStats(state,{role:'admin'},'2026-11-16','2026-11-16','2')[0].sent,1);
const daily=shipmentStats(state,{role:'admin'},'2026-11-16','2026-11-16','',true);
assert.equal(daily.length,1);assert.equal(daily[0].label,'2026-11-16');assert.equal(daily[0].sent,7);assert.equal(daily[0].redeemed,2);assert.equal(daily[0].returned,1);
orders[0].status='redeemed';orders[orders.length-1].status='redeemed';
const later=shipmentStats(state,{role:'admin'},'2026-11-16','2026-11-16','',true)[0];
assert.equal(later.sent,7);assert.equal(later.redeemed,3);assert.equal(later.returned,1);
assert.equal(shipmentDay(order('c',{delivery:'cdek_courier',cdekTransferredAt:'2026-11-16',shippedAt:undefined})), '2026-11-16');
assert.equal(shipmentStats(state,{role:'department_head'},'','').length,0);
assert.equal(shipmentStats(state,{role:'admin'},'2027-01-01','2027-01-01').length,0);
console.log('Shipment cohort: Moscow dates, CDEK export, deduplication, later buyouts, returns, imports and role/department scopes passed');
const november={employees,orders:Array.from({length:50},(_,i)=>order('NOV-'+i,{status:i<40?'redeemed':'returned',redeemedAt:'2026-12-10',returnedAt:'2026-12-11'}))};
const month=shipmentStats(november,{role:'admin'},'2026-11-01','2026-11-30')[0];
assert.deepEqual([month.sent,month.redeemed,month.returned],[50,40,10]);
const days=shipmentStats(november,{role:'admin'},'2026-11-01','2026-11-30','',true);
assert.deepEqual([days[0].sent,days[0].redeemed,days[0].returned],[50,40,10]);

const exported=order('exported-13',{delivery:'cdek_pickup',cdekTransferredAt:'2026-11-13T10:00:00Z',shippedAt:'2026-11-13T10:00:00Z',cdekAcceptedAt:'2026-11-16T10:00:00Z'});
assert.equal(shipmentDay(exported),'2026-11-13');
assert.equal(shipmentStats({employees,orders:[exported]},{role:'admin'},'2026-11-16','2026-11-16').length,0);
assert.equal(shipmentStats({employees,orders:[exported]},{role:'admin'},'2026-11-13','2026-11-13')[0].sentCdek,1);
assert.equal(shipmentDay({...exported,cdekTransferredAt:undefined}),'2026-11-13');
assert.equal(shipmentDay({...exported,cdekTransferredAt:undefined,shippedAt:undefined}),'');
exported.cdekAcceptedAt='2026-11-20T09:00:00Z';exported.status='redeemed';
const originalDay=shipmentStats({employees,orders:[exported]},{role:'admin'},'2026-11-13','2026-11-13')[0];
assert.equal(originalDay.sent,1);assert.equal(originalDay.redeemed,1);

// Physical Moscow custody is a shipment even before the courier confirms delivery.
const physical=order('physical',{delivery:'moscow_courier',status:'packing',shippedAt:undefined,courier:{acceptedAt:'2026-11-12T07:57:46Z'}});
const physicalRows=()=>shipmentStats({employees,orders:[physical]},{role:'admin'},'2026-11-12','2026-11-12')[0];
assert.equal(physicalRows().sentMoscow,1);assert.equal(physicalRows().sent,1);
physical.status='refused';assert.equal(physicalRows().sent,1);assert.equal(physicalRows().returned,0);
physical.status='returned';physical.warehouseReturnedAt='2026-11-16T07:24:10Z';assert.equal(physicalRows().sent,1);assert.equal(physicalRows().returned,1);
physical.status='redeemed';assert.equal(physicalRows().sent,1);assert.equal(physicalRows().redeemed,1);
physical.shippedAt='2026-11-13T10:00:00Z';assert.equal(shipmentDay(physical),'2026-11-12','Later client confirmation cannot move the shipment cohort');
physical.courier.acceptedAt='2026-11-14T10:00:00Z';assert.equal(shipmentDay(physical),'2026-11-13','A subsequent courier receipt cannot move an already recorded shipment');
assert.equal(shipmentDay({...physical,shippedAt:undefined,courier:{assignedAt:'2026-11-12T10:00:00Z'}}),'','Assignment without physical receipt is not a shipment');

assert.equal(shipmentDay({...physical,shippedAt:undefined,courier:undefined,courierHandedAt:'2026-11-12T07:57:46Z'}),'2026-11-12','Physical handoff survives recall and replacement of courier assignment');
