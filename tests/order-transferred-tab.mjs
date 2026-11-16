import assert from 'node:assert/strict';
import {orderDisplayGroup,orderDisplayGroups} from '../lib/order-premium-stage.ts';
import {filteredOrderList} from '../lib/crm-order-list.ts';
const ids=orderDisplayGroups.map(g=>g.id);
assert.deepEqual(ids.slice(0,3),['new','transferred','accepted']);
const orders=['draft','confirm','rework','check','extra','packing'].map(status=>({id:status,clientId:'c',manager:'op',status,items:[],delivery:'cdek_courier',round:1}));
assert.deepEqual(orders.map(o=>orderDisplayGroup(o).id),['new','transferred','new','accepted','accepted','accepted']);
const employee={id:'op',role:'operator'},state={orders,clients:[{id:'c',name:'Test',owner:'op'}],employees:[employee],settings:{}};
const query={view:'orders',query:'',showNextPremium:false};
assert.deepEqual(filteredOrderList(state,employee,{...query,filter:'new'}).map(o=>o.id),['draft']);
assert.deepEqual(filteredOrderList(state,employee,{...query,filter:'transferred'}).map(o=>o.id),['confirm']);
assert.equal(filteredOrderList(state,employee,{...query,filter:'new',query:'confirm'})[0].id,'confirm');
assert.equal(filteredOrderList({...state,orders:[...orders,{...orders[0],id:'other',manager:'other'}]},employee,{...query,filter:'new'}).length,1);
assert.deepEqual(filteredOrderList(state,employee,{...query,view:'rework',filter:'new'}).map(o=>o.id),['rework']);
console.log('New/transferred groups, dedicated operator rework, unchanged accepted stages, cross-status search and ownership passed');
const admin={id:'admin',role:'admin'};
const mixed={...state,orders:[
 {...orders[0],id:'older-draft',createdAt:'2026-11-15T10:00:00Z',items:[{price:20,quantity:1}]},
 {...orders[2],id:'newer-return',createdAt:'2026-11-16T12:00:00Z',items:[{price:100,quantity:1}]},
 {...orders[0],id:'newer-draft',createdAt:'2026-11-16T10:00:00Z',items:[{price:10,quantity:1}]},
]};
assert.deepEqual(filteredOrderList(mixed,admin,{...query,filter:'new'}).map(o=>o.id),['newer-draft','older-draft','newer-return']);
assert.deepEqual(filteredOrderList(mixed,admin,{...query,filter:'new',sort:'total',direction:'desc',manualSort:true}).map(o=>o.id),['older-draft','newer-draft','newer-return']);
assert.equal(filteredOrderList(mixed,{id:'head',role:'department_head',department:'1'},{...query,filter:'new'}).length,0);
assert.equal(filteredOrderList(mixed,admin,{...query,filter:'new',query:'return'}).length,1);
