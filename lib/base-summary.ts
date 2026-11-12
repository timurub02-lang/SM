import type {ActivityDb} from './activity-store.ts';
// Preserve the table scan's first source for legacy empty-sheet groups after index ordering.
export const baseCountsQuery=`SELECT CASE WHEN json_extract(data,'$.baseType')='J' THEN 'J' ELSE 'M' END AS base,COALESCE(json_extract(data,'$.sheet'),'') AS sheet,COALESCE(json_extract(data,'$.source'),'') AS source,COUNT(*) AS total,SUM(CASE WHEN COALESCE(json_extract(data,'$.owner'),'')<>'' THEN 1 ELSE 0 END) AS assigned,CAST(MIN(rowid) AS TEXT) AS first_rowid FROM clients WHERE length(data)>=0 GROUP BY base,sheet,CASE WHEN json_extract(data,'$.sheet') IS NULL THEN source ELSE '' END`;
export const assignedCountsQuery="SELECT json_extract(data,'$.owner') AS owner,COUNT(*) AS total FROM clients WHERE COALESCE(json_extract(data,'$.owner'),'')<>'' GROUP BY 1";
export const releasedTodayQuery="SELECT COALESCE(json_extract(data,'$.baseType'),'M') AS base,COUNT(*) AS total FROM clients WHERE COALESCE(json_extract(data,'$.owner'),'')='' AND date(json_extract(data,'$.releasedAt'),'+3 hours')=? GROUP BY base";
const ready=new WeakMap<ActivityDb,Promise<void>>();
export function initBaseSummaryIndexes(d:ActivityDb){
 let pending=ready.get(d);if(pending)return pending;
 // All NOT NULL data qualify; explicit opt-in keeps old code's table-scan source selection on rollback.
 pending=d.batch([
  "CREATE INDEX IF NOT EXISTS idx_clients_base_summary ON clients(CASE WHEN json_extract(data,'$.baseType')='J' THEN 'J' ELSE 'M' END,COALESCE(json_extract(data,'$.sheet'),''),CASE WHEN json_extract(data,'$.sheet') IS NULL THEN COALESCE(json_extract(data,'$.source'),'') ELSE '' END,COALESCE(json_extract(data,'$.owner'),'')<>'') WHERE length(data)>=0",
  "CREATE INDEX IF NOT EXISTS idx_clients_assigned_owner ON clients(json_extract(data,'$.owner')) WHERE COALESCE(json_extract(data,'$.owner'),'')<>''",
  "CREATE INDEX IF NOT EXISTS idx_clients_release_time ON clients(COALESCE(json_extract(data,'$.baseType'),'M'),json_extract(data,'$.releasedAt')) WHERE COALESCE(json_extract(data,'$.owner'),'')=''",
 ].map(sql=>d.prepare(sql))).then(()=>{}).catch(error=>{ready.delete(d);throw error;});
 ready.set(d,pending);return pending;
}
