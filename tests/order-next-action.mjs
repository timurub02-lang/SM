import assert from 'node:assert/strict';
import {seed} from '../lib/crm.ts';
import {filteredOrderList} from '../lib/crm-order-list.ts';
import {orderNextAction} from '../lib/order-next-action.ts';
const base={clientId:'c',manager:'op',status:'redeemed',contact:'none',items:[],createdAt:'2026-11-12T10:00:00Z',delivery:'moscow_courier'};
const orders=[{...base,id:'cash1',courier:{id:'courier',assignedAt:base.createdAt,acceptedAt:base.createdAt}},{...base,id:'empty1',delivery:'cdek_courier',cdekStatus:{code:'DELIVERED'}},{...base,id:'cash2',courier:{id:'courier',assignedAt:base.createdAt,acceptedAt:base.createdAt}},{...base,id:'empty2',delivery:'russian_post'}];
assert.equal(orderNextAction(orders[1]),'—');assert.equal(orderNextAction(orders[3]),'—');assert.notEqual(orderNextAction(orders[0]),'—');
const state={...seed(),orders,clients:[{id:'c',name:'Client'}]},admin={id:'admin',role:'admin'};
for(const direction of ['asc','desc']){
 const labels=filteredOrderList(state,admin,{view:'orders',filter:'paid',query:'',showNextPremium:false,sort:'action',direction}).map(orderNextAction);
 assert.equal(labels.length,4);assert.equal(labels[0],labels[1]);assert.equal(labels[2],labels[3]);assert.notEqual(labels[1],labels[2]);
}
console.log('Displayed next actions sort together for paid courier, CDEK and post orders');
