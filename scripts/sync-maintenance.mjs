import {openDatabase} from '../server/sqlite.ts';
import {runCrmMaintenance} from '../lib/crm-maintenance.ts';
const path=process.env.CRM_DATABASE_PATH;if(!path)throw Error('CRM_DATABASE_PATH is required');
const db=openDatabase(path),start=performance.now();
try{
 const result=await runCrmMaintenance(db);
 await db.prepare("INSERT INTO settings(id,data) VALUES('crm-maintenance-health',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify({ok:true,at:new Date().toISOString(),durationMs:Math.round(performance.now()-start),...result})).run();
 console.log(JSON.stringify(result));
}catch{
 await db.prepare("INSERT INTO settings(id,data) VALUES('crm-maintenance-health',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify({ok:false,at:new Date().toISOString()})).run();
 console.error('CRM maintenance failed; check service status');process.exitCode=1;
}finally{db.close();}
