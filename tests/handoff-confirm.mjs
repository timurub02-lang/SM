import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Exercise the actual UI handoff gate without changing a live order.
const source=readFileSync(new URL('../components/crm-app.tsx',import.meta.url),'utf8');
const start=source.indexOf('if(data.action==="transition"&&["confirm","extra"].includes(String(data.to))&&handoff?.status');
const end=source.indexOf("if(data.action==='transition'&&data.to==='packing'",start);
assert.ok(start>=0&&end>start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const gate=new AsyncFunction('data','handoff','isRefusalRework','handoffResolve','setClarificationHandoff','setHandoffOpen',source.slice(start,end).replace('new Promise<boolean>','new Promise')+'return data;');
for(const kind of ['clarification','refusal','delivery']){
 for(const accepted of [false,true]){
  const ref={current:null};let opened=false,clarification;
  const pending=gate({action:'transition',to:'confirm'},{status:'rework',returnKind:kind},o=>!['clarification','delivery'].includes(o.returnKind),ref,v=>clarification=v,()=>opened=true);
  assert.equal(opened,kind!=='delivery');
  if(opened){assert.equal(clarification,kind==='clarification');ref.current(accepted);}
  const result=await pending;
  assert.equal(result!==false,kind==='delivery'||accepted);
 }
}
assert.ok(source.includes('Вы внесли исправления в заказ?'));
console.log('Clarification/refusal require explicit acceptance; cancel stops handoff; delivery unchanged.');
