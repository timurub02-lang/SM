import type {ActivityDb} from './activity-store.ts';
import type {Employee,State} from './crm.ts';
import {initPreparedModels,readModelSource,publishPreparedModels,scopeRevisionSql,type PreparedWrite} from './crm-read-model.ts';
import {initFinancialProjection,buildFinancialProjection,financialStageStatements,applyFinancialProjection,type FinancialProjection} from './crm-financial-projection.ts';
import {initCrmReadIndexes} from './crm-read-indexes.ts';
import {readWorkspaceState} from './crm-workspace-read.ts';
import {initWorkspaceContext,buildWorkspaceContext,refreshWorkspaceFinancialContext} from './crm-workspace-context.ts';
import {workspaceVersions} from './crm-workspace-clock.ts';
import {buildWorkspaceSummary} from './crm-workspace-summary.ts';
import {compactCrmState} from './compact-crm-state.ts';

type Reader=ActivityDb&{readSnapshot<T>(read:()=>Promise<T>):Promise<T>};
type CachedContext={key:string;json:string;bytes:number;financialRevision?:string};
export class ContextCache {
 readonly entries=new Map<string,CachedContext>();bytes=0;
 readonly maxBytes:number;readonly maxScopes:number;
 constructor(maxBytes=128*1024*1024,maxScopes=128){this.maxBytes=maxBytes;this.maxScopes=maxScopes;}
 get(id:string,key:string){const entry=this.entries.get(id);if(!entry||entry.key!==key)return;this.entries.delete(id);this.entries.set(id,entry);return JSON.parse(entry.json) as State;}
 set(id:string,key:string,state:State,financialRevision?:string){const old=this.entries.get(id);if(old){this.bytes-=old.bytes;this.entries.delete(id);}const json=JSON.stringify(state),bytes=Buffer.byteLength(json);if(bytes>this.maxBytes)return;
  while(this.entries.size>=this.maxScopes||this.bytes+bytes>this.maxBytes){const first=this.entries.keys().next().value;if(first===undefined)break;this.bytes-=this.entries.get(first)!.bytes;this.entries.delete(first);}
  this.entries.set(id,{key,json,bytes,financialRevision});this.bytes+=bytes;
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
 const cache=new ContextCache(),lastSummaries=new Map<string,number>();let financial:FinancialProjection|undefined,financialKey='',lastFinance=0;
 const stats={ticks:0,financialBuilds:0,contextBuilds:0,financialContextRefreshes:0,contextWrites:0,summaryBuilds:0,rejected:0};
 async function tick(injectedNow?:number){
  // Tests may freeze time explicitly; the daemon samples the real clock per scope.
  const now=injectedNow??Date.now(),currentTime=()=>injectedNow??Date.now();
  if(!await claimSummaryLease(writer,token,now))return {leader:false,...stats,cacheBytes:cache.bytes};
  await writer.prepare('DELETE FROM crm_model_demand WHERE requested_at<?').bind(now-3600000).run();
  // A new schema may have appeared since the previous tick; initialise outside BEGIN.
  await initPreparedModels(reader);await initPreparedModels(writer);
  const month=moscowMonth(now);
  const financeSnapshot=await reader.readSnapshot(async()=>{
   const source=await readModelSource(reader),key=source.financeRevision+':'+source.accessRevision+':'+month;
   const scopes=(await reader.prepare("SELECT e.id,e.data,e.version FROM crm_model_demand q JOIN employees e ON e.id=q.employee_id WHERE q.requested_at>=? AND json_extract(e.data,'$.role') IN ('operator','department_head') ORDER BY q.requested_at DESC,e.id LIMIT 128").bind(now-3600000).all()).results.map((r:{data:string;version:number})=>({...JSON.parse(r.data),version:r.version})) as Employee[];
   cache.retain(new Set(scopes.map(e=>e.id)));
   const financeChanged=!financial||financialKey!==key;
   const projection=financeChanged?await buildFinancialProjection(reader,now):financial!;
   if(financeChanged)stats.financialBuilds++;
   return {source,key,projection,scopes,financeDue:financeChanged||now-lastFinance>=20000};
  });
  let published=true;
  if(financeSnapshot.financeDue){
   const {source,projection}=financeSnapshot;
   const rows:PreparedWrite[]=[{kind:'finance',scope:'global',data:projection},{kind:'finance-meta',scope:'global',data:{activePeriod:projection.activePeriod,nextPeriod:projection.stageProjection.nextPeriod}}].map(row=>({...row,sourceRevision:source.financeRevision,accessRevision:source.accessRevision,computedAt:now,validUntil:now+30000}));
   published=await publishPreparedModels(writer,rows,await financialStageStatements(writer,projection),token);
   if(published){financial=projection;financialKey=financeSnapshot.key;lastFinance=now;}else{stats.rejected++;financial=undefined;}
  }
  const active=new Set(financeSnapshot.scopes.map(e=>e.id));for(const id of lastSummaries.keys())if(!active.has(id))lastSummaries.delete(id);
  // Publish each scope before reading the next one. A slow/cold department cannot hold
  // already computed operational summaries behind a whole-workspace transaction.
  for(const requested of published?financeSnapshot.scopes:[]){
   const snapshot=await reader.readSnapshot(async()=>{
    const source=await readModelSource(reader);
    if(source.financeRevision!==financeSnapshot.source.financeRevision||source.accessRevision!==financeSnapshot.source.accessRevision)return null;
    const employee=await reader.prepare('SELECT data,version FROM employees WHERE id=?').bind(requested.id).first();
    if(!employee)return null;const actor={...JSON.parse(employee.data),version:employee.version} as Employee;
    if(!['operator','department_head'].includes(actor.role))return null;
    const versions=await workspaceVersions(reader,actor);
    // All scoped source changes bump tasks; a foreign redeemed-order broadcast only bumps workspace/cards.
    // Access, employee/settings changes and day boundaries still require a full enriched rebuild.
    const contextKey=[versions.tasks,source.accessRevision,moscowDay(currentTime())].join(':');
    let state=cache.get(actor.id,contextKey),built=false;
    const financialChangedForScope=!!state&&cache.entries.get(actor.id)?.financialRevision!==source.financeRevision;
    if(!state){const raw=await readWorkspaceState(reader,actor,false);applyFinancialProjection(financial!,raw);raw.financialReadModel={status:'ready',schemaVersion:1,computedAt:new Date(currentTime()).toISOString(),sourceRevision:source.financeRevision};state=compactCrmState(await buildWorkspaceContext(reader,actor,raw,currentTime()));stats.contextBuilds++;built=true;}
    else if(financialChangedForScope){built=await refreshWorkspaceFinancialContext(reader,actor,state,financial!,currentTime());state.financialReadModel={status:'ready',schemaVersion:1,computedAt:new Date(currentTime()).toISOString(),sourceRevision:source.financeRevision};stats.financialContextRefreshes++;}
    const computedAt=currentTime(),rows:PreparedWrite[]=[];
    if(built){rows.push({kind:'context',scope:actor.id,data:state,sourceRevision:versions.workspace,accessRevision:source.accessRevision,computedAt,validUntil:computedAt+3000});stats.contextWrites++;}
    if(built||financialChangedForScope||computedAt-(lastSummaries.get(actor.id)||0)>=1000){rows.push({kind:'summary',scope:actor.id,data:buildWorkspaceSummary(state,actor,computedAt),sourceRevision:versions.workspace,accessRevision:source.accessRevision,computedAt,validUntil:computedAt+3000});stats.summaryBuilds++;}
    return {source,actor,contextKey,state,built,rows,computedAt,revision:versions.workspace};
   });
   if(!snapshot){published=false;stats.rejected++;financial=undefined;break;}
   if(!snapshot.rows.length)continue;
   const extra=snapshot.built?[]:[writer.prepare(`UPDATE crm_read_models SET source_revision=?,valid_until=?,scope_revision=${scopeRevisionSql('?')} WHERE kind='context' AND scope=? AND access_revision=?`).bind(snapshot.revision,snapshot.computedAt+3000,snapshot.actor.id,snapshot.actor.id,snapshot.source.accessRevision)];
   // Fence the financial generation used by this scope even though finance itself
   // was already published in a separate atomic transaction.
   extra.unshift(writer.prepare("UPDATE crm_model_publish_guard SET allowed=CASE WHEN EXISTS(SELECT 1 FROM crm_model_source m CROSS JOIN crm_change_clock c WHERE m.id=1 AND c.id=1 AND c.epoch||':'||m.epoch||':'||m.finance=?) THEN 1 ELSE 0 END WHERE id=1").bind(snapshot.source.financeRevision));
   const accepted=await publishPreparedModels(writer,snapshot.rows,extra,token);
   if(!accepted){published=false;stats.rejected++;financial=undefined;break;}
   if(snapshot.built)cache.set(snapshot.actor.id,snapshot.contextKey,snapshot.state,snapshot.source.financeRevision);
   else {const entry=cache.entries.get(snapshot.actor.id);if(entry)entry.financialRevision=snapshot.source.financeRevision;}
   lastSummaries.set(snapshot.actor.id,snapshot.computedAt);
  }
  await writer.prepare("UPDATE crm_model_worker SET ok=1,heartbeat=?,message='' WHERE id=1 AND token=? AND lease_until>?").bind(Date.now(),token,Date.now()).run();
  stats.ticks++;return {leader:true,published,...stats,cacheBytes:cache.bytes,scopes:financeSnapshot.scopes.length};
 }
 return {tick,cache,stats,token};
}
