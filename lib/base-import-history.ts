import type {ActivityDb} from './activity-store.ts';
export type ImportHistoryEntry={id:string;filename:string;at:string;added:number;male:number;female:number;skipped:number;duplicates:number;moved:number;invalid:{row:number;phone:string;reason:string}[]};
export async function baseImportHistory(d:ActivityDb):Promise<ImportHistoryEntry[]>{
 const exists=await d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='base_import_backups'").first();
 if(!exists)return [];
 // Read reports only: backups also contain private pre-import client snapshots.
 const rows=(await d.prepare(`WITH recent AS (
 SELECT json_extract(data,'$.session') AS session FROM base_import_backups
 GROUP BY session ORDER BY MAX(at) DESC LIMIT 100)
 SELECT at,json_extract(data,'$.session') AS session,json_extract(data,'$.filename') AS filename,
 json_extract(data,'$.base') AS base,json_extract(data,'$.report') AS report
 FROM base_import_backups WHERE json_extract(data,'$.session') IN (SELECT session FROM recent) ORDER BY at DESC,id DESC`).all()).results as {at:string;session:string;filename:string;base:string;report:string}[];
 const sessions=new Map<string,ImportHistoryEntry>();
 for(const row of rows){
  const r=JSON.parse(row.report),entry:ImportHistoryEntry=sessions.get(row.session)||{id:row.session,filename:row.filename,at:row.at,added:0,male:0,female:0,skipped:0,duplicates:0,moved:0,invalid:[]};
  entry.added+=r.added||0;entry.male+=r.addedByBase?.M??(row.base==='M'?r.added||0:0);entry.female+=r.addedByBase?.J??(row.base==='J'?r.added||0:0);
  entry.skipped+=r.skipped||0;entry.duplicates+=r.duplicates||0;entry.moved+=r.moved||0;entry.invalid.push(...r.invalid||[]);sessions.set(row.session,entry);
 }
 return [...sessions.values()];
}
