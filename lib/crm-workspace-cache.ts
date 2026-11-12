import {createHash} from 'node:crypto';
import type {ActivityDb} from './activity-store.ts';
import type {Employee} from './crm.ts';
import {workspaceVersions,type WorkspaceVersions} from './crm-workspace-clock.ts';
import {preparedModelsEnabled,readPreparedModel,readModelSource} from './crm-read-model.ts';
type Entry={body:Uint8Array;headers:Headers;at:number;bytes:number};
const stores=new WeakMap<ActivityDb,{entries:Map<string,Entry>;pending:Map<string,Promise<Entry>>;bytes:number}>();
const maxBytes=32*1024*1024,maxEntries=256,ttl=5000;

// Auth is checked by the caller on every hit. Cached bytes cannot be mutated by another request.
export async function cachedWorkspaceResponse(d:ActivityDb,e:Employee,request:Request,area:keyof WorkspaceVersions,parameters:unknown,build:()=>Promise<Response>){
 let store=stores.get(d);if(!store){store={entries:new Map(),pending:new Map(),bytes:0};stores.set(d,store);}
 const revision=(await workspaceVersions(d,e))[area],now=Date.now();
 const finance=preparedModelsEnabled()?await readPreparedModel(d,'finance-meta','global',(await readModelSource(d)).financeRevision):undefined;
 const key=JSON.stringify([e.id,revision,finance&&[finance.status,finance.sourceRevision,finance.computedAt],parameters,request.headers.get('accept-encoding'),Math.floor(now/ttl)]);
 const etag='W/"'+createHash('sha256').update(key).digest('base64url')+'"';
 const headers={'ETag':etag,'Cache-Control':'private, no-store','Vary':'Cookie, Accept-Encoding','X-CRM-Source-Revision':revision,'X-CRM-Schema-Version':'1'};
 // A revision-based 304 never constructs or hashes the entity lists.
 if(request.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers});
 for(const [id,entry] of store.entries)if(now-entry.at>=ttl){store.entries.delete(id);store.bytes-=entry.bytes;}
 let entry=store.entries.get(key);
 if(entry){store.entries.delete(key);store.entries.set(key,entry);}
 if(!entry){
  let pending=store.pending.get(key);
  if(!pending){
   const cache=store;
   pending=(async()=>{
    const response=await build();if(response.status!==200)throw Error('Workspace response is unavailable');
    const body=new Uint8Array(await response.arrayBuffer()),value={body,headers:new Headers(response.headers),at:Date.now(),bytes:body.byteLength};
    value.headers.set('X-CRM-Computed-At',new Date(value.at).toISOString());
    // A concurrent save must not publish a result under the old source revision.
    if((await workspaceVersions(d,e))[area]===revision&&value.bytes<=maxBytes){
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
 return new Response(new Uint8Array(entry.body),{headers:result});
}
