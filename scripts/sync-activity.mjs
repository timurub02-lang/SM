import {openDatabase} from '../server/sqlite.ts';
import {syncActivity} from '../lib/activity-sync.ts';
const path=process.env.CRM_DATABASE_PATH;if(!path)throw Error('CRM_DATABASE_PATH is required');
const db=openDatabase(path);
try{console.log(JSON.stringify(await syncActivity(db)));}catch{console.error('Activity sync failed; see activity-health in CRM');process.exitCode=1;}finally{db.close();}
