import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../components/crm-app.tsx',import.meta.url),'utf8');
const expression=source.match(/const quickTransitions=([^;]+);/)[1];
const evaluate=new Function('o','allowed','guided','locked','courierDoorRefusal',`return ${expression}`);
for(const delivery of ['cdek_office','cdek_courier','moscow_courier','russian_post']){
 for(const status of ['packing','phone']){
  const order={delivery,status};
  assert.ok(evaluate(order,['rework','phone'],delivery.startsWith('cdek'),false,()=>false).includes('rework'));
  assert.deepEqual(evaluate(order,[],true,false,()=>false),[],'no extra permission');
  assert.deepEqual(evaluate(order,['rework'],false,true,()=>false),[],'locked order');
  assert.deepEqual(evaluate(order,['rework'],false,false,()=>true),[],'door refusal keeps dedicated flow');
 }
}
assert.match(source,/transitionSection\(allowed.filter\(to=>!quickTransitions.includes\(to\)/,'quick actions excluded from bottom form');
console.log('Packing return uses the shared top action for all delivery methods; permission and lock guards preserved');
