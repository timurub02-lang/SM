import {initSkOrders} from '../../lib/sk-order-import.ts';
import {initBaseDispatch} from '../../lib/base-dispatch.ts';
import {initialBaseSettings} from '../../lib/base-policy.ts';
export async function seedSkDispatch(d,entries){
 await initSkOrders(d);await initBaseDispatch(d);
 const config=initialBaseSettings();config.M.sheets.find(s=>s.name==='Т1').projectId='12345';
 await d.prepare("INSERT INTO settings(id,data) VALUES('base-settings',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify({config})).run();
 await d.prepare("INSERT OR IGNORE INTO base_dispatch_jobs VALUES('fixture','M','Т1','12345','2026-01-01','2026-01-01T00:00:00Z',NULL)").run();
 for(const [id,phone] of entries){
  await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(id,phone,JSON.stringify({id,phone,name:'Synthetic',owner:'',baseType:'M',sheet:'Т1'})).run();
  await d.prepare("INSERT INTO base_dispatch_items VALUES('fixture',?,'sent','','2026-01-01T00:00:00Z')").bind(id).run();
 }
}
