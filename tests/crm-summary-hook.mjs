import assert from 'node:assert/strict';
import {build} from 'esbuild';
const slots=[],effects=[],requests=[],timers=new Map();let cursor=0,nextTimer=1;
globalThis.__crmSummaryHooks={
 useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},
 useEffect(effect,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((value,i)=>value!==previous.deps[i]))effects.push(()=>{previous?.cleanup?.();slots[index]={deps,cleanup:effect()};});},
};
const built=await build({entryPoints:['hooks/use-crm-summary.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'test-react',setup(api){api.onResolve({filter:/^react$/},()=>({path:'react',namespace:'test'}));api.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const {useState,useEffect}=globalThis.__crmSummaryHooks;'}));}}]});
const {useCrmSummary}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const original={window:globalThis.window,document:globalThis.document,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),fetch:globalThis.fetch,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
const win=new EventTarget(),doc=new EventTarget();win.location={replace:()=>{}};doc.hidden=false;
globalThis.window=win;globalThis.document=doc;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
globalThis.fetch=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}));
globalThis.setInterval=(callback,ms)=>{const id=nextTimer++;timers.set(id,{callback,ms});return id;};globalThis.clearInterval=id=>timers.delete(id);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
let actor='a',enabled=true;const render=()=>{cursor=0;const result=useCrmSummary(enabled,actor);while(effects.length)effects.shift()();return result;};
const reply=async(index,value,status=200)=>{requests[index].resolve(Response.json(value,{status}));await flush();await flush();};
try{
 render();assert.equal(requests.length,1);assert.deepEqual([...timers.values()].map(t=>t.ms),[30000]);
 win.dispatchEvent(new Event('crm-summary-changed'));win.dispatchEvent(new Event('crm-summary-changed'));assert.equal(requests.length,1);
 await reply(0,{status:'pending',schemaVersion:1});assert.equal(requests.length,2,'ready event during pending GET queues one follow-up');
 await reply(1,{status:'ready',schemaVersion:1,data:{nav:{incoming:1}}});assert.equal(render().model.status,'ready');assert.equal(requests.length,2,'no two-second polling');
 doc.hidden=true;win.dispatchEvent(new Event('crm-summary-changed'));assert.equal(requests.length,2);doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(requests.length,3);await reply(2,{status:'ready',schemaVersion:1,data:{nav:{incoming:2}}});
 navigator.onLine=false;win.dispatchEvent(new Event('crm-summary-changed'));assert.equal(requests.length,3);navigator.onLine=true;win.dispatchEvent(new Event('online'));assert.equal(requests.length,4);await reply(3,{status:'ready',schemaVersion:1,data:{nav:{incoming:3}}});
 [...timers.values()][0].callback();assert.equal(requests.length,5);actor='b';assert.equal(render().model,undefined);assert.equal(requests.length,6);assert.equal(requests[4].options.signal.aborted,true);
 await reply(4,{status:'ready',schemaVersion:1,data:{private:'a'}});assert.equal(render().model,undefined,'old actor response cannot repopulate state');await reply(5,{status:'ready',schemaVersion:1,data:{private:'b'}});
 win.dispatchEvent(new Event('focus'));assert.equal(requests.length,7);await reply(6,{error:'Access removed'},403);assert.equal(render().model.data,undefined,'revoked access clears retained data');
 enabled=false;render();assert.equal(timers.size,0);win.dispatchEvent(new Event('crm-summary-changed'));assert.equal(requests.length,7,'cleanup removes event listeners');
 console.log('Summary hook: queued publication event, 30s fallback, focus/visibility/online, actor isolation, access revocation and cleanup passed');
}finally{for(const slot of slots)slot?.cleanup?.();globalThis.window=original.window;globalThis.document=original.document;if(original.navigator)Object.defineProperty(globalThis,'navigator',original.navigator);else delete globalThis.navigator;globalThis.fetch=original.fetch;globalThis.setInterval=original.setInterval;globalThis.clearInterval=original.clearInterval;delete globalThis.__crmSummaryHooks;}
