import type {ActivityDb as Db} from './activity-store.ts';
export async function initBaseStorage(d:Db){
 await d.prepare('CREATE TABLE IF NOT EXISTS client_phone_index(phone TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE)').run();
 const source="SELECT phone AS value FROM clients WHERE id=NEW.id UNION SELECT value FROM json_each(COALESCE(json_extract(NEW.data,'$.linkedPhones'),'[]'))";
 const clean="replace(replace(replace(replace(replace(value,'+',''),' ',''),'-',''),'(',''),')','')";
 const normalized=`CASE WHEN length(${clean})=11 AND substr(${clean},1,1)='8' THEN '7'||substr(${clean},2) ELSE ${clean} END`;
 for(const [name,event,remove] of [['insert','INSERT',''],['update','UPDATE OF phone,data','DELETE FROM client_phone_index WHERE client_id=NEW.id;']])await d.prepare(`CREATE TRIGGER IF NOT EXISTS client_phone_${name} AFTER ${event} ON clients BEGIN ${remove} INSERT INTO client_phone_index(phone,client_id) SELECT DISTINCT ${normalized},NEW.id FROM (${source}) WHERE value<>''; END`).run();
 const done=await d.prepare("SELECT id FROM settings WHERE id='base-phone-index-v1'").first();
 if(!done)await d.batch([d.prepare('UPDATE clients SET phone=phone'),d.prepare("INSERT OR IGNORE INTO settings(id,data) VALUES('base-phone-index-v1','{}')")]);
}
