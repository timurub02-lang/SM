import {initBaseStorage} from './base-storage';
import {z} from 'zod';
import {db} from './db';
import {planImport,type ExistingClient} from './base-import';
import {clientSheet,type Client} from './crm';
import {baseSettingsSchema,initialBaseSettings} from './base-policy';
const input=z.object({base:z.enum(['M','J']),rows:z.array(z.object({row:z.number().int().positive(),phone:z.string().max(100),name:z.string().max(300),linkedPhones:z.array(z.string().max(100)).max(20).optional(),fields:z.record(z.string().max(2000)).optional()})).min(1).max(1000),choices:z.record(z.enum(['M','J'])).default({}),apply:z.boolean().default(false),filename:z.string().max(200),revision:z.string().max(100),session:z.string().uuid(),offset:z.number().int().min(0).max(10000000).default(0)});
export async function importBase(raw:unknown,actorId:string){
 const p=input.parse(raw),d=db();await initBaseStorage(d);await d.prepare('CREATE TABLE IF NOT EXISTS base_import_backups(id TEXT PRIMARY KEY,at TEXT NOT NULL,data TEXT NOT NULL)').run();const id='BI-'+p.session+'-'+p.offset;if(p.apply){const previous=await d.prepare('SELECT data FROM base_import_backups WHERE id=?').bind(id).first<{data:string}>();if(previous)return {...JSON.parse(previous.data).report,applied:true,backupId:id};}const saved=await d.prepare("SELECT data FROM settings WHERE id='base-settings'").first<{data:string}>();
 const settings=saved?JSON.parse(saved.data):{config:initialBaseSettings(),revision:''};if(settings.revision!==p.revision)throw Error('Настройки листов изменились. Откройте импорт заново');
 const target=baseSettingsSchema.parse(settings.config)[p.base].importSheet;
 const rows=(await d.prepare('SELECT id,data,version FROM clients').all<{id:string;data:string;version:number}>()).results;
 const clients=rows.map(r=>{const c=JSON.parse(r.data) as Client;return {...c,sheet:clientSheet(c)||'Т1',version:r.version} as ExistingClient;});
 const plan=planImport(p.rows,clients,p.base,target,p.choices);
 const report={added:plan.added.length,moved:plan.moved.length,skipped:plan.skipped,duplicates:plan.duplicates,invalid:plan.invalid,conflicts:plan.conflicts};
 if(!p.apply||plan.conflicts.length)return {...report,applied:false};
 const at=new Date().toISOString();
 await d.prepare('CREATE TABLE IF NOT EXISTS base_import_snapshots(session TEXT NOT NULL,client_id TEXT NOT NULL,phone TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(session,client_id))').run();
 await d.prepare('CREATE TABLE IF NOT EXISTS base_import_sessions(id TEXT PRIMARY KEY,created_at TEXT NOT NULL)').run();
 await d.prepare('CREATE TABLE IF NOT EXISTS base_import_backups(id TEXT PRIMARY KEY,at TEXT NOT NULL,data TEXT NOT NULL)').run();
 await d.prepare('CREATE TABLE IF NOT EXISTS base_import_checks(valid INTEGER CHECK(valid=1))').run();
 const added=plan.added.map(r=>({id:'C-'+crypto.randomUUID(),baseType:p.base,phone:'+'+r.phone,linkedPhones:(r.linkedPhones||[]).map(phone=>'+'+phone),name:r.name||r.phone,city:'',address:'',source:p.filename,sheet:target,owner:'',assignedUntil:'',createdAt:at,version:1,importFields:r.fields||{},distributedAt:''}));
 const backup={session:p.session,actorId,base:p.base,target,filename:p.filename,previous:plan.moved.map(x=>rows.find(r=>r.id===x.client.id)),addedIds:added.map(c=>c.id),report};
 const statements=[d.prepare('INSERT INTO base_import_snapshots(session,client_id,phone,data,version) SELECT ?,id,phone,data,version FROM clients WHERE NOT EXISTS(SELECT 1 FROM base_import_sessions WHERE id=?)').bind(p.session,p.session),d.prepare('INSERT OR IGNORE INTO base_import_sessions VALUES(?,?)').bind(p.session,at),d.prepare('INSERT INTO base_import_backups(id,at,data) VALUES(?,?,?)').bind(id,at,JSON.stringify(backup)),d.prepare("INSERT INTO base_import_checks(valid) SELECT 0 WHERE COALESCE((SELECT json_extract(data,'$.revision') FROM settings WHERE id='base-settings'),'')<>?").bind(p.revision)];
 for(const move of plan.moved){const row=rows.find(r=>r.id===move.client.id)!;statements.push(d.prepare('INSERT INTO base_import_checks(valid) SELECT 0 WHERE NOT EXISTS(SELECT 1 FROM clients WHERE id=? AND version=?)').bind(row.id,row.version),d.prepare('UPDATE clients SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify({...JSON.parse(row.data),baseType:move.baseType,sheet:move.sheet}),row.id));}
 for(const c of added)statements.push(d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(c.id,c.phone,JSON.stringify(c)));
 await d.batch(statements);
 return {...report,applied:true,backupId:id};
}
