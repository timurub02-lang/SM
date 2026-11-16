import {normalizePhone} from './crm.ts';
import {readBaseDestination} from './base-destination.ts';
import {initBaseDispatch} from './base-dispatch.ts';
import type {ActivityDb as Db} from './activity-store.ts';
export type SkProjectMembership={projectId:string;leadId:string;checkedAt:string;jobId?:string};
type Target={callId:string;leadId:string;phone:string;name:string};
export async function checkSkProjectMembership(d:Db,target:Target,now:number){
 await initBaseDispatch(d);
 const {config}=await readBaseDestination(d);
 const projects=(['M','J'] as const).flatMap(base=>config[base].sheets.filter(s=>s.projectId&&!['К','ЧС','ПВ'].includes(s.name)).map(s=>({base,sheet:s.name,project:s.projectId})));
 // The configured project ID is the cycle boundary, not a rolling number of days.
 const found=await d.prepare(`SELECT j.id,j.project FROM client_phone_index p
 JOIN base_dispatch_items i ON i.client_id=p.client_id AND i.state='sent'
 JOIN base_dispatch_jobs j ON j.id=i.job_id
 WHERE p.phone=? AND EXISTS(SELECT 1 FROM json_each(?) active
 WHERE json_extract(active.value,'$.base')=j.base AND json_extract(active.value,'$.sheet')=j.sheet
 AND json_extract(active.value,'$.project')=j.project)
 ORDER BY i.updated_at DESC LIMIT 1`).bind(normalizePhone(target.phone).replace(/\D/g,''),JSON.stringify(projects)).first();
 return found?{status:'found' as const,membership:{projectId:String(found.project),leadId:target.leadId,jobId:String(found.id),checkedAt:new Date(now).toISOString()}}:{status:'not-found' as const};
}
