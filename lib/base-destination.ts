import type {ActivityDb as Db} from './activity-store.ts';
import {baseSettingsSchema,dispatchTargetSchema,initialBaseSettings} from './base-policy.ts';
export const oktellDispatchPending='Передача клиентов в Oktell настраивается. Отправка из базы приостановлена.';
export async function readBaseDestination(d:Db){
 const row=await d.prepare("SELECT data FROM settings WHERE id='base-settings'").first();
 const saved=row?JSON.parse(row.data):null;
 return {config:baseSettingsSchema.parse(saved?.config||initialBaseSettings()),revision:String(saved?.revision||'')};
}
export async function saveBaseDestination(d:Db,target:unknown,revision:string){
 const dispatchTarget=dispatchTargetSchema.parse(target),saved=await readBaseDestination(d);
 if(saved.revision!==revision)return null;
 const next={config:{...saved.config,dispatchTarget},revision:crypto.randomUUID()};
 const write=await d.prepare("INSERT INTO settings(id,data) VALUES('base-settings',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE COALESCE(json_extract(settings.data,'$.revision'),'')=?").bind(JSON.stringify(next),revision).run();
 return write.meta.changes?next:null;
}
