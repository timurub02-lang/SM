import {openDatabase} from '../server/sqlite.ts';
import {syncLvWarehouse} from '../lib/lv-warehouse.ts';
const path=process.env.CRM_DATABASE_PATH;if(!path)throw Error('CRM_DATABASE_PATH is required');
const db=openDatabase(path);
try{console.log(JSON.stringify(await syncLvWarehouse(db)));}catch{console.error('LV warehouse sync failed; check integration settings');process.exitCode=1;}finally{db.close();}
