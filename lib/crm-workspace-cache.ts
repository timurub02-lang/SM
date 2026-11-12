import {createHash} from 'node:crypto';
import type {ActivityDb} from './activity-store.ts';
import {confirmationDeadline,type Employee,type State} from './crm.ts';
import {defaultOrderPolicy} from './order-policy.ts';
import {workspaceVersions,type WorkspaceVersions} from './crm-workspace-clock.ts';
import {preparedModelsEnabled,readPreparedModel,readModelSource} from './crm-read-model.ts';
type Entry={body:Uint8Array;headers:Headers;at:number;validUntil:number;etag:string;bytes:number};
const stores=new WeakMap<ActivityDb,{entries:Map<string,Entry>;pending:Map<string,Promise<Entry>>;bytes:number}>();
const maxBytes=32*1024*1024,maxEntries=256,ttl=5000;

// Raw order pages have no ticking text. Their selectors change at these boundaries;
// ordinary mutations and financial readiness still invalidate through the live key.
export function orderListNextChange(state:State,now=Date.now()){
 const day=86400000,policy=state.settings.orderPolicy||defaultOrderPolicy;
 let next=(Math.floor((now+10800000)/day)+1)*day-10800000;
 const include=(at:number)=>{if(Number.isFinite(at)&&at>now)next=Math.min(next,at);};
 for(const order of state.orders){
  include(Date.parse(order.confirmationRequest?.at||'')-300000);
  const confirmation=Date.parse(confirmationDeadline(order)||'');
  include(confirmation-policy.finalWarningHours*3600000);include(confirmation);
  const rework=Date.parse(order.reworkDeadline||'');
  include(rework-policy.reworkWarningHours*3600000);include(rework);
  include(Date.parse(order.due||''));
 }
 return next;
}

// Auth is checked by the caller on every hit. Cached bytes cannot be mutated by another request.
export async function cachedWorkspaceResponse(d:ActivityDb,e:Employee,request:Request,area:keyof WorkspaceVersions,parameters:unknown,build:()=>Promise<Response>){
 let store=stores.get(d);if(!store){store={entries:new Map(),pending:new Map(),bytes:0};stores.set(d,store);}
 const revision=(await workspaceVersions(d,e))[area],now=Date.now();
 const finance=area!=='tasks'&&preparedModelsEnabled()?await readPreparedModel(d,'finance-meta','global',(await readModelSource(d)).financeRevision):undefined;
 const key=JSON.stringify([e.id,revision,finance&&[finance.status,finance.sourceRevision],parameters,request.headers.get('accept-encoding')]);
 const headers={'Cache-Control':'private, no-store','Vary':'Cookie, Accept-Encoding','X-CRM-Source-Revision':revision,'X-CRM-Schema-Version':'1'};
 for(const [id,entry] of store.entries)if(now>=entry.validUntil){store.entries.delete(id);store.bytes-=entry.bytes;}
 let entry=store.entries.get(key);
 if(entry){store.entries.delete(key);store.entries.set(key,entry);}
 if(!entry){
  let pending=store.pending.get(key);
  if(!pending){
   const cache=store;
   pending=(async()=>{
    const builtAt=Date.now(),response=await build();if(response.status!==200)throw Error('Workspace response is unavailable');
    const body=new Uint8Array(await response.arrayBuffer()),boundary=Number(response.headers.get('X-CRM-Cache-Until'));
    const value={body,headers:new Headers(response.headers),at:Date.now(),validUntil:boundary>0?boundary:builtAt+ttl,etag:'W/"'+createHash('sha256').update(key).update(body).digest('base64url')+'"',bytes:body.byteLength};
    value.headers.delete('X-CRM-Cache-Until');
    value.headers.set('X-CRM-Computed-At',new Date(value.at).toISOString());
    // A concurrent save must not publish a result under the old source revision.
    if((await workspaceVersions(d,e))[area]===revision&&value.validUntil>Date.now()&&value.bytes<=maxBytes){
     cache.entries.set(key,value);cache.bytes+=value.bytes;
     for(const [id,old] of cache.entries){if(cache.bytes<=maxBytes&&cache.entries.size<=maxEntries)break;cache.entries.delete(id);cache.bytes-=old.bytes;}
    }
    return value;
   })().finally(()=>cache.pending.delete(key));
   // Bound coalescing metadata as well as retained bodies under arbitrary filter requests.
   if(cache.pending.size<maxEntries)cache.pending.set(key,pending);
  }
  entry=await pending;
 }
 const result=new Headers(entry.headers);for(const [name,value] of Object.entries(headers))result.set(name,value);
 result.set('ETag',entry.etag);
 // Expired entries must be recomputed before a content-based 304 can be returned.
 if(request.headers.get('if-none-match')===entry.etag)return new Response(null,{status:304,headers:result});
 return new Response(new Uint8Array(entry.body),{headers:result});
}
