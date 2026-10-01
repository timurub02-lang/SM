import type {Employee} from './crm.ts';
import {activityRow,shiftWindow,type ActivitySample,type WorkSchedule} from './activity.ts';
// The same tiny DB surface is supplied by D1 in the app and SQLite in the collector.
export type ActivityDb={prepare:(sql:string)=>any;batch:(statements:any[])=>Promise<any>};
export async function initActivity(d:ActivityDb){await d.prepare('CREATE TABLE IF NOT EXISTS activity_incidents(id TEXT PRIMARY KEY,employee_id TEXT NOT NULL,started_at TEXT NOT NULL,detected_at TEXT NOT NULL,ended_at TEXT,reason TEXT NOT NULL)').run();await d.prepare('CREATE INDEX IF NOT EXISTS activity_incidents_employee ON activity_incidents(employee_id,detected_at)').run();}
export async function readActivity(d:ActivityDb,now=Date.now()){
 const staff=(await d.prepare('SELECT data FROM employees').all()).results.map((r:{data:string})=>JSON.parse(r.data) as Employee);
 const configs=(await d.prepare("SELECT id,data FROM settings WHERE id LIKE 'activity-%'").all()).results;
 const values=Object.fromEntries(configs.map((r:{id:string;data:string})=>[r.id,JSON.parse(r.data)]));
 const day=new Date(now+3*3600000).toISOString().slice(0,10),start=`${day}T00:00:00+03:00`;
 const events=(await d.prepare("SELECT json_extract(data,'$.actorId') AS employee_id,MAX(at) AS at,COUNT(*) AS count FROM events WHERE at>=? AND id NOT LIKE 'IMPORT-%' AND json_extract(data,'$.actorId') IS NOT NULL AND json_extract(data,'$.actor')<>'Система' GROUP BY json_extract(data,'$.actorId')").bind(new Date(start).toISOString()).all()).results;
 const schedules=values['activity-schedules']||{} as Record<string,WorkSchedule>;
 const samples=values['activity-samples']||{} as Record<string,ActivitySample>;
 const rows=staff.map((e:Employee)=>{const s=samples[e.id];return activityRow(e,schedules[e.department||''],s?.day===day?(values['activity-health']?.ok?s:{...s,observedAt:''}):undefined,events.find((r:any)=>r.employee_id===e.id)||{at:'',count:0},now);});
 return {staff,schedules,rows,health:values['activity-health']||{ok:false,message:'Первое подключение ещё не выполнено',checkedAt:''}};
}
export async function recordActivityIncidents(d:ActivityDb,now=Date.now()){
 await initActivity(d);const {rows}=await readActivity(d,now),at=new Date(now).toISOString();
 for(const row of rows){const current=await d.prepare('SELECT id FROM activity_incidents WHERE employee_id=? AND ended_at IS NULL').bind(row.id).first();
  if(row.state==='idle'&&!current){const minutes=row.skStatus==='away'?Math.max(0,row.breakMinutes-row.breakLimit):(row.idleMinutes||0);const start=new Date(now-minutes*60000).toISOString();await d.prepare('INSERT OR IGNORE INTO activity_incidents(id,employee_id,started_at,detected_at,reason) VALUES(?,?,?,?,?)').bind(`${row.id}:${start}`,row.id,start,at,row.label).run();}
  else if(current&&row.state!=='idle')await d.prepare('UPDATE activity_incidents SET ended_at=? WHERE id=? AND ended_at IS NULL').bind(at,current.id).run();
 }
}
