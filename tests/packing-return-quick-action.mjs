import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../components/crm-app.tsx',import.meta.url),'utf8');
const expression=source.match(/const quickTransitions=([^;]+);/)[1];
const evaluate=new Function('o','allowed','guided','locked','courierDoorRefusal','workGateSkOnly=false',`return ${expression}`);
for(const delivery of ['cdek_office','cdek_courier','moscow_courier','russian_post']){
 for(const status of ['packing','phone']){
  const order={delivery,status};
  assert.ok(evaluate(order,['rework','phone'],delivery.startsWith('cdek'),false,()=>false).includes('rework'));
  assert.deepEqual(evaluate(order,[],true,false,()=>false),[],'no extra permission');
  assert.deepEqual(evaluate(order,['rework'],false,true,()=>false),[],'locked order');
  assert.deepEqual(evaluate(order,['rework'],false,false,()=>true),[],'door refusal keeps dedicated flow');
 }
}
assert.match(source,/transitionSection\(allowed.filter\(to=>\(!workGateSkOnly\|\|to===\"confirm\"\)&&!quickTransitions.includes\(to\)/,'quick actions excluded from bottom form');
console.log('Packing return uses the shared top action for all delivery methods; permission and lock guards preserved');

for(const status of ['confirm','extra'])assert.ok(evaluate({status,delivery:'russian_post'},['packing'],false,false,()=>false).includes('packing'));
for(const delivery of ['moscow_courier','russian_post'])assert.ok(evaluate({status:'packing',delivery},['shipping'],false,false,()=>false).includes('shipping'));

for(const status of ['shipping','pickup'])assert.deepEqual(evaluate({status,delivery:'russian_post'},['redeemed','returned'],false,false,()=>false),['redeemed','returned']);
assert.deepEqual(evaluate({status:'shipping',delivery:'russian_post'},[],false,false,()=>false),[]);
assert.deepEqual(evaluate({status:'shipping',delivery:'cdek_courier'},['redeemed','returned'],false,false,()=>false),[]);

assert.deepEqual(evaluate({status:'draft',delivery:'russian_post'},['confirm','refused'],false,false,()=>false,true),['confirm'],'SK exception exposes only handoff while incoming blocks work');
