import assert from 'node:assert/strict';
import {build} from 'esbuild';

// Exercise the actual hook with deterministic React scheduling and delayed HTTP responses.
const slots=[],effects=[],requests=[];let cursor=0;
globalThis.__crmCardHooks={
 useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
 useRef(initial){const i=cursor++;return slots[i]??=( {current:initial} );},
 useEffect(effect,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((value,index)=>value!==previous.deps[index])){effects.push(()=>{previous?.cleanup?.();slots[i]={deps,cleanup:effect()};});}},
};
const built=await build({entryPoints:['hooks/use-crm-card.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',plugins:[{
 name:'test-react',setup(api){api.onResolve({filter:/^react$/},()=>({path:'react',namespace:'test'}));api.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const {useState,useRef,useEffect}=globalThis.__crmCardHooks;'}));},
}]});
const {useCrmCard}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
class Control {
 constructor(tag,attributes={}){this.tag=tag;this.attributes=attributes;}
 matches(selector){return selector.split(',').some(part=>part===this.tag||/^\[([^=]+)="([^"]+)"\]$/.test(part)&&this.attributes[RegExp.$1]===RegExp.$2);}
 closest(selector){return this.matches(selector)?this:null;}
}
globalThis.Element=Control;
let redirected;
globalThis.window={location:{replace:path=>{redirected=path;}}};
globalThis.fetch=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}));
let actor='one',target={type:'order',id:'o1'},card;
function render(){cursor=0;card=useCrmCard(true,actor,target);while(effects.length)effects.shift()();return card;}
function answer(data,status=200){assert.ok(requests.length,'expected an HTTP read');requests.shift().resolve(Response.json(data,{status}));}
async function settle(){await new Promise(setImmediate);render();}
const state=(version,status='draft',id=target?.id)=>({clients:[{id:'c1',name:'Synthetic'}],orders:[{id,version,status,comment:'saved'}],settings:{},employees:[]});
async function open(id){target={type:'order',id};render();answer(state(1));await settle();assert.equal(card.data.orders[0].id,id);}

render();answer(state(1));await settle();
card.protect({type:'click',target:new Control('button',{role:'tab'})});
card.protect({type:'click',target:new Control('input')});
card.protect({type:'click',target:new Control('button',{'data-slot':'dialog-close'})});
assert.equal(card.preserve(),false,'navigation and focusing a text field do not protect a draft');
let checking=card.check();answer(state(2,'confirm'));await checking;render();
assert.equal(card.data.orders[0].status,'confirm','a clean open card gets the new status');
assert.equal(card.stale,undefined);

checking=card.check();
card.protect({type:'change',target:new Control('textarea')});
answer(state(3,'packing'));await checking;render();
assert.equal(card.preserve(),true);
assert.equal(card.data.orders[0].version,2,'typing during an outstanding GET retains the CAS version');
assert.equal(card.data.orders[0].status,'confirm');
assert.equal(card.latest.orders[0].status,'packing','latest status remains visible beside the protected form');
assert.equal(card.stale,true);

checking=card.check();card.update(current=>({...current,orders:[{...current.orders[0],version:4,comment:'own save'}]}));
answer(state(3,'packing'));await checking;render();
assert.equal(card.data.orders[0].version,4,'an older GET cannot undo a successful local mutation');
assert.equal(card.latest,undefined);
assert.equal(card.preserve(),true,'saving one action does not discard other nested drafts');
checking=card.check();answer({error:'Synthetic outage'},503);await checking;render();
assert.equal(card.data.orders[0].comment,'own save','temporary read failures preserve the form');

checking=card.check();target={type:'order',id:'o2'};render();
assert.equal(card.data,undefined,'the previous card is hidden as soon as the target changes');
assert.equal(card.preserve(),false);
answer(state(9,'packing','o1'));await checking;answer(state(1));await settle();
assert.equal(card.data.orders[0].id,'o2','a late response for the old target cannot expose its contents');
card.protect({type:'click',target:new Control('button')});
assert.equal(card.preserve(),true,'button-selected nested actions protect drafts too');
checking=card.check();answer(state(2,'shipping'));await checking;render();
assert.equal(card.data.orders[0].version,1);assert.equal(card.latest.orders[0].version,2);

for(const status of [403,404]){
 checking=card.check();answer({error:'Denied'},status);await checking;render();
 assert.equal(card.data,undefined);assert.equal(card.latest,undefined);assert.ok(card.error,'revoked or deleted cards clear both snapshots');
 await open('after-'+status);
}
card.protect({type:'keydown',target:new Control('button',{role:'combobox'})});
assert.equal(card.preserve(),true,'keyboard selection protects a nested picker');
checking=card.check();answer({error:'Unauthorized'},401);await checking;
assert.equal(redirected,'/login');
actor='two';render();assert.equal(card.data,undefined,'changing account hides the old account card');assert.equal(card.preserve(),false);
answer(state(1));await settle();
target=null;render();assert.equal(card.data,undefined);assert.equal(card.latest,undefined);
for(const slot of slots)slot?.cleanup?.();
delete globalThis.__crmCardHooks;
console.log('PASS: clean live status, protected input/action drafts, in-flight races, own saves, target/account isolation and access revocation');
