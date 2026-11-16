import {normalizePhone} from './crm.ts';
import type {ActivityDb as Db} from './activity-store.ts';
export type SkProjectMembership={projectId:string;leadId:string;checkedAt:string};
type Target={callId:string;leadId:string;phone:string;name:string};
type Cursor={target:string;projects:string[];project:number;page:number};
const clean=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,' ');
export function skProjectClientMatches(row:any,target:Target){
 const values=Array.isArray(row.lead_phones)?row.lead_phones:typeof row.phones==='string'?row.phones.split(/[,;\n]/):[];
 const phone=normalizePhone(target.phone);
 return /^[1-9]\d*$/.test(String(row.id))&&!!phone&&values.some((p:unknown)=>typeof p==='string'&&normalizePhone(p)===phone)&&
  (String(row.id)===target.leadId||typeof row.name==='string'&&clean(row.name)===clean(target.name));
}
// Positive evidence only: changing provider pagination may miss a member, never authorize a non-member.
export async function checkSkProjectMembership(d:Db,api:(path:string)=>Promise<any>,target:Target,now:number){
 const key='sk-project-check:'+target.callId,identity=JSON.stringify([target.leadId,normalizePhone(target.phone),clean(target.name)]);
 const saved=await d.prepare('SELECT data FROM settings WHERE id=?').bind(key).first();
 let cursor:Cursor|undefined=saved?JSON.parse(saved.data):undefined;
 if(!cursor||cursor.target!==identity){
  const projects:{id:string;active:boolean}[]=[];
  for(let page=1;page<=100;page++){
   const r=await api('/api/v2/call_projects?length=100&page='+page),rows=Array.isArray(r)?r:r.data;
   if(!Array.isArray(rows))throw Error('Не удалось проверить проекты СК');
   for(const row of rows){if(!/^[1-9]\d*$/.test(String(row.id)))throw Error('Некорректный проект СК');projects.push({id:String(row.id),active:row.state==='active'});}
   if(rows.length<100||r.pagination?.total_pages&&page>=r.pagination.total_pages)break;
   if(page===100)throw Error('Список проектов СК неполный');
  }
  cursor={target:identity,projects:[...new Set(projects.sort((a,b)=>Number(b.active)-Number(a.active)).map(p=>p.id))],project:0,page:1};
 }
 // Bound work per retry so project checks cannot monopolize webhook leases or the shared API quota.
 for(let budget=0;budget<3&&cursor.project<cursor.projects.length;budget++){
  const projectId=cursor.projects[cursor.project];
  const r=await api('/api/v2/leads?call_project_id='+projectId+'&length=100&page='+cursor.page);
  const pagination=r.pagination;
  if(!Array.isArray(r.data)||!pagination||pagination.page!==cursor.page||!Number.isInteger(pagination.total_pages)||pagination.total_pages<0)throw Error('Состав проекта СК не подтверждён');
  const member=r.data.find((row:any)=>skProjectClientMatches(row,target));
  if(member){
   await d.prepare('DELETE FROM settings WHERE id=?').bind(key).run();
   return {status:'found' as const,membership:{projectId,leadId:String(member.id),checkedAt:new Date(now).toISOString()}};
  }
  if(cursor.page>=pagination.total_pages){cursor.project++;cursor.page=1;}else cursor.page++;
 }
 if(cursor.project>=cursor.projects.length){await d.prepare('DELETE FROM settings WHERE id=?').bind(key).run();return {status:'not-found' as const};}
 await d.prepare('INSERT INTO settings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(key,JSON.stringify(cursor)).run();
 return {status:'pending' as const};
}
