import type {ActivityDb} from './activity-store.ts';
import type {Employee,State} from './crm.ts';
import {initPreparedModels,readModelSource,publishPreparedModels,type PreparedWrite} from './crm-read-model.ts';
import {initFinancialProjection,buildFinancialProjection,financialStageStatements,applyFinancialProjection,type FinancialProjection} from './crm-financial-projection.ts';
import {initCrmReadIndexes} from './crm-read-indexes.ts';
import {readWorkspaceState} from './crm-workspace-read.ts';
import {initWorkspaceContext,buildWorkspaceContext} from './crm-workspace-context.ts';
import {workspaceVersions} from './crm-workspace-clock.ts';
import {buildWorkspaceSummary} from './crm-workspace-summary.ts';
import {compactCrmState} from './compact-crm-state.ts';

type Reader=ActivityDb&{readSnapshot<T>(read:()=>Promise<T>):Promise<T>};
type CachedContext={key:string;json:string;bytes:number};
export class ContextCache {
 readonly entries=new Map<string,CachedContext>();bytes=0;
 readonly maxBytes:number;readonly maxScopes:number;
 constructor(maxBytes=128*1024*1024,maxScopes=128){this.maxBytes=maxBytes;this.maxScopes=maxScopes;}
 get(id:string,key:string){const entry=this.entries.get(id);if(!entry||entry.key!==key)return;this.entries.delete(id);this.entries.set(id,entry);return JSON.parse(entry.json) as State;}
 set(id:string,key:string,state:State){const old=this.entries.get(id);if(old){this.bytes-=old.bytes;this.entries.delete(id);}const json=JSON.stringify(state),bytes=Buffer.byteLength(json);if(bytes>this.maxBytes)return;
  while(this.entries.size>=this.maxScopes||this.bytes+bytes>this.maxBytes){const first=this.entries.keys().next().value;if(first===undefined)break;this.bytes-=this.entries.get(first)!.bytes;this.entries.delete(first);}
  this.entries.set(id,{key,json,bytes});this.bytes+=bytes;
 }
 retain(ids:Set<string>){for(const [id,entry] of this.entries)if(!ids.has(id)){this.entries.delete(id);this.bytes-=entry.bytes;}}
}
export const moscowMonth=(now:number)=>new Date(now+10800000).toISOString().slice(0,7);
export const moscowDay=(now:number)=>new Date(now+10800000).toISOString().slice(0,10);
export async function claimSummaryLease(d:ActivityDb,token:string,now=Date.now(),ttl=30000){
 await initPreparedModels(d);
 const result=await d.prepare("UPDATE crm_model_worker SET token=?,lease_until=?,heartbeat=?,ok=1,message='' WHERE id=1 AND (token=? OR lease_until<=?)").bind(token,now+ttl,now,token,now).run();return result.meta.changes===1;
}
export async function renewSummaryLease(d:ActivityDb,token:string,now=Date.now(),ttl=30000){const result=await d.prepare("UPDATE crm_model_worker SET lease_until=?,heartbeat=? WHERE id=1 AND token=? AND lease_until>?").bind(now+ttl,now,token,now).run();return result.meta.changes===1;}
export async function releaseSummaryLease(d:ActivityDb,token:string){await d.prepare("UPDATE crm_model_worker SET lease_until=0,ok=0,message='Обработчик остановлен' WHERE id=1 AND token=?").bind(token).run();}

export async function createSummaryWorker(writer:ActivityDb,reader:Reader,token=crypto.randomUUID()){
 // All lazy stores/triggers are ready before the dedicated read transaction starts.
 await initWorkspaceContext(reader);await initCrmReadIndexes(reader);await initFinancialProjection(reader);await initPreparedModels(reader);await initPreparedModels(writer);
 const cache=new ContextCache();let financial:FinancialProjection|undefined,financialKey='',lastFinance=0,lastSummary=0;
 const stats={ticks:0,financialBuilds:0,contextBuilds:0,summaryBuilds:0,rejected:0};
 async function tick(now=Date.now()){
  if(!await claimSummaryLease(writer,token,now))return {leader:false,...stats,cacheBytes:cache.bytes};
  await writer.prepare('DELETE FROM crm_model_demand WHERE requested_at<?').bind(now-3600000).run();
  // A new schema may have appeared since the previous tick; initialise outside BEGIN.
  await initPreparedModels(reader);await initPreparedModels(writer);
  const month=moscowMonth(now);
  const snapshot=await reader.readSnapshot(async()=>{
   const source=await readModelSource(reader),key=source.financeRevision+':'+source.accessRevision+':'+month;
   const scopes=(await reader.prepare("SELECT e.id,e.data,e.version FROM crm_model_demand q JOIN employees e ON e.id=q.employee_id WHERE q.requested_at>=? AND json_extract(e.data,'$.role') IN ('operator','department_head') ORDER BY q.requested_at DESC,e.id LIMIT 128").bind(now-3600000).all()).results.map((r:{data:string;version:number})=>({...JSON.parse(r.data),version:r.version})) as Employee[];
   cache.retain(new Set(scopes.map(e=>e.id)));
   const financeChanged=!financial||financialKey!==key;
   if(financeChanged){financial=await buildFinancialProjection(reader,now);financialKey=key;stats.financialBuilds++;}
   const financeDue=financeChanged||now-lastFinance>=20000,rows:PreparedWrite[]=[],contexts:{id:string;key:string;state:State}[]=[],refresh:string[]=[];
   const write=(kind:string,scope:string,data:unknown,revision:string,ttl:number)=>rows.push({kind,scope,data,sourceRevision:revision,accessRevision:source.accessRevision,computedAt:now,validUntil:now+ttl});
   if(financeDue){write('finance','global',financial,source.financeRevision,30000);write('finance-meta','global',{activePeriod:financial!.activePeriod,nextPeriod:financial!.stageProjection.nextPeriod},source.financeRevision,30000);}
   for(const actor of scopes){
    const versions=await workspaceVersions(reader,actor),contextKey=[versions.workspace,source.accessRevision,financialKey,moscowDay(now)].join(':');
    let state=cache.get(actor.id,contextKey),built=false;
    if(!state){const raw=await readWorkspaceState(reader,actor,false);applyFinancialProjection(financial!,raw);raw.financialReadModel={status:'ready',schemaVersion:1,computedAt:new Date(now).toISOString(),sourceRevision:source.financeRevision};state=compactCrmState(await buildWorkspaceContext(reader,actor,raw,now));stats.contextBuilds++;built=true;contexts.push({id:actor.id,key:contextKey,state});}
    if(built)write('context',actor.id,state,versions.workspace,3000);
    if(built||now-lastSummary>=2000){if(!built)refresh.push(actor.id);write('summary',actor.id,buildWorkspaceSummary(state,actor,now),versions.workspace,3000);stats.summaryBuilds++;}
   }
   return {source,financeDue,rows,contexts,refresh,scopeCount:scopes.length};
  });
  const stages=snapshot.financeDue?await financialStageStatements(writer,financial!):[];
  // Refresh freshness without rewriting large unchanged context blobs.
  for(const id of snapshot.refresh)stages.push(writer.prepare("UPDATE crm_read_models SET valid_until=? WHERE kind='context' AND scope=? AND access_revision=?").bind(now+3000,id,snapshot.source.accessRevision));
  // Scoped versions mark concurrent non-access edits stale without starving every other scope.
  const published=!snapshot.rows.length||await publishPreparedModels(writer,snapshot.rows,stages,token);
  if(published){for(const c of snapshot.contexts)cache.set(c.id,c.key,c.state);if(snapshot.financeDue)lastFinance=now;if(snapshot.rows.some(r=>r.kind==='summary'))lastSummary=now;}
  else {stats.rejected++;financial=undefined;}
  await writer.prepare("UPDATE crm_model_worker SET ok=1,heartbeat=?,message='' WHERE id=1 AND token=? AND lease_until>?").bind(Date.now(),token,Date.now()).run();
  stats.ticks++;return {leader:true,published,...stats,cacheBytes:cache.bytes,scopes:snapshot.scopeCount};
 }
 return {tick,cache,stats,token};
}
