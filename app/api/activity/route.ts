import {authenticated} from '@/lib/api-auth';
import {db} from '@/lib/db';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {initActivity,readActivity} from '@/lib/activity-store';
import {visibleActivityEmployee} from '@/lib/activity';
import type {Employee} from '@/lib/crm';
import {z} from 'zod';
export const dynamic='force-dynamic';
async function actor(req:Request){if(!await getChatGPTUser())return null;const r=await db().prepare('SELECT data FROM employees WHERE id=?').bind(new URL(req.url).searchParams.get('actorId')||'').first<{data:string}>();return r?JSON.parse(r.data) as Employee:null;}
async function get(req:Request){
 const e=await actor(req);if(!e||!['admin','department_head'].includes(e.role))return Response.json({error:'Недостаточно прав'},{status:403});
 const d=db();await initActivity(d);const result=await readActivity(d),allowed=new Set(result.staff.filter((s:Employee)=>visibleActivityEmployee(e,s)).map((s:Employee)=>s.id));
 const incidents=(await d.prepare('SELECT id,employee_id AS employeeId,started_at AS startedAt,detected_at AS detectedAt,ended_at AS endedAt,reason FROM activity_incidents ORDER BY detected_at DESC LIMIT 500').all()).results.filter((r:any)=>allowed.has(r.employeeId)).slice(0,100);
 return Response.json({rows:result.rows.filter((r:any)=>allowed.has(r.id)),schedules:Object.fromEntries(Object.entries(result.schedules).filter(([id])=>e.role==='admin'||e.department===id)),health:result.health,incidents,now:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
}
const schedule=z.object({department:z.enum(['1','2','3','4','5']),days:z.array(z.number().int().min(0).max(6)).min(1).max(7),start:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),end:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),breakMinutes:z.number().int().min(0).max(180)}).refine(v=>v.start<v.end,'Окончание смены должно быть позже начала');
async function post(req:Request){const e=await actor(req);if(!e||e.role!=='admin')return Response.json({error:'Графики настраивает администратор'},{status:403});try{const p=schedule.parse(await req.json());const {department,...value}=p;const d=db();await d.prepare("INSERT OR IGNORE INTO settings(id,data) VALUES('activity-schedules','{}')").run();await d.prepare("UPDATE settings SET data=json_set(data,?,json(?)) WHERE id='activity-schedules'").bind('$."'+department+'"',JSON.stringify(value)).run();return Response.json({ok:true});}catch{return Response.json({error:'Проверьте график: дни, время начала и окончания, длительность обеда'},{status:400});}}
export const GET=authenticated(get);
export const POST=authenticated(post);
