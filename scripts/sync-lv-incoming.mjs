import {openDatabase} from '../server/sqlite.ts';
import {syncLvIncoming} from '../lib/lv-incoming-sync.ts';
const path=process.env.CRM_DATABASE_PATH;if(!path)throw Error('CRM_DATABASE_PATH is required');
const db=openDatabase(path);
try{console.log(JSON.stringify(await syncLvIncoming(db)));}
catch{console.error('LV incoming sync failed; see integration health');process.exitCode=1;}
finally{db.close();}
