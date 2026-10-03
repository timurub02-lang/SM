// Run after taking a database backup. Existing explicit base assignments are preserved.
import {openDatabase} from '../server/sqlite.ts';
import {initialBaseSettings,baseSettingsSchema,normalizeBaseSheet} from '../lib/base-policy.ts';
import {initBaseStorage} from '../lib/base-storage.ts';
import {initBaseDispatch} from '../lib/base-dispatch.ts';
const path=process.env.CRM_DATABASE_PATH;if(!path)throw Error('CRM_DATABASE_PATH is required');
const d=openDatabase(path);
try{
 const old=await d.prepare("SELECT data FROM settings WHERE id='base-settings'").first();const config=old?baseSettingsSchema.parse(JSON.parse(old.data).config):initialBaseSettings();
 const rows=(await d.prepare('SELECT id,data,version FROM clients').all()).results,statements=[];
 for(const row of rows){const c=JSON.parse(row.data),base=c.baseType==='J'?'J':'M',sheet=normalizeBaseSheet(c.sheet||(c.owner?'К':c.source?.match(/\.xlsx · (.+)$/i)?.[1]||config[base].importSheet));
 const next={...c,baseType:base,sheet,...(c.returnSheet?{returnSheet:normalizeBaseSheet(c.returnSheet)}:{}),...(c.trialReturnSheet?{trialReturnSheet:normalizeBaseSheet(c.trialReturnSheet)}:{})};
 if(!config[base].sheets.some(s=>s.name===sheet))config[base].sheets.push({name:sheet,automatic:false,projectId:'',cycleDays:20,sendTime:'21:00'});
 if(JSON.stringify(next)!==row.data)statements.push(d.prepare('UPDATE clients SET data=?,version=version+1 WHERE id=? AND version=?').bind(JSON.stringify(next),row.id,row.version));
 }
 if(!old)statements.push(d.prepare("INSERT OR IGNORE INTO settings(id,data) VALUES('base-settings',?)").bind(JSON.stringify({config:baseSettingsSchema.parse(config),revision:crypto.randomUUID()})));
 if(statements.length)await d.batch(statements);
 await initBaseStorage(d);await initBaseDispatch(d);
 await d.prepare("CREATE INDEX IF NOT EXISTS clients_base_sheet_owner ON clients(COALESCE(json_extract(data,'$.baseType'),'M'),json_extract(data,'$.sheet'),COALESCE(json_extract(data,'$.owner'),''))").run();
 console.log(JSON.stringify({clientsChecked:rows.length,automaticEnabled:Object.values(config).filter(x=>x&&typeof x==='object'&&'sheets' in x).flatMap(x=>x.sheets).filter(s=>s.automatic).length}));
}finally{d.close();}
