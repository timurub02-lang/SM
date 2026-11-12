import {createHash} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {conditionalJson} from './conditional-json.ts';
import {entityFields,type EntityField,type CrmStateDelta} from './crm-state-delta.ts';
import type {State} from './crm.ts';
type Fingerprints=Record<EntityField,Map<string,string>>;
type Entry={at:number;rows:number;fingerprints:Fingerprints};
const snapshots=new Map<string,Entry>();
const hashes=new Map<string,string>(),maxHashBytes=16*1024*1024;let hashBytes=0;
function hash(text:string){
 const saved=hashes.get(text);
 if(saved!==undefined){hashes.delete(text);hashes.set(text,saved);return saved;}
 const value=createHash('sha256').update(text).digest('base64url'),bytes=text.length*2+256;
 // Exact serialized content includes derived fields; versions alone cannot identify a response row.
 if(bytes<=maxHashBytes/16){
  hashes.set(text,value);hashBytes+=bytes;
  while(hashBytes>maxHashBytes||hashes.size>20000){const oldest=hashes.keys().next().value!;hashBytes-=oldest.length*2+256;hashes.delete(oldest);}
 }
 return value;
}

// Delta bases contain fingerprints scoped to the authenticated user; missing bases recover with a full response.
export async function crmSnapshotResponse(request:Request,state:State,userId:string){
 const meta={...state} as Partial<State>,fingerprints={} as Fingerprints;
 const digest=createHash('sha256');let rows=0,yieldAt=performance.now()+2;
 for(const field of entityFields){
  delete meta[field];const entries:[string,string][]=[];
  for(const row of state[field]){
   entries.push([row.id,hash(JSON.stringify(row))]);
   if(performance.now()>=yieldAt){await setImmediate();yieldAt=performance.now()+2;}
  }
  fingerprints[field]=new Map(entries);rows+=entries.length;digest.update(JSON.stringify([field,entries]));
 }
 digest.update(JSON.stringify(meta));const etag='W/"'+digest.digest('base64url')+'"';
 const previous=request.headers.get('if-none-match')||'',key=userId+'\0'+etag,now=Date.now();
 const before=snapshots.get(userId+'\0'+previous);
 let body:State|CrmStateDelta=state;
 if(before&&previous!==etag){
  const entities={} as CrmStateDelta['entities'];
  for(const field of entityFields)entities[field]={ids:state[field].map(row=>row.id),upsert:state[field].filter(row=>before.fingerprints[field].get(row.id)!==fingerprints[field].get(row.id))};
  body={kind:'crm-delta',meta:meta as CrmStateDelta['meta'],entities};
 }
 snapshots.delete(key);snapshots.set(key,{at:now,rows,fingerprints});
 let total=[...snapshots.values()].reduce((n,s)=>n+s.rows,0);
 for(const [id,entry] of snapshots){if(now-entry.at>120000||total>250000){snapshots.delete(id);total-=entry.rows;}}
 if(previous===etag)return new Response(null,{status:304,headers:{ETag:etag,'Cache-Control':'private, no-store',Vary:'Cookie, Accept-Encoding'}});
 const response=await conditionalJson(request,body);response.headers.set('ETag',etag);return response;
}
