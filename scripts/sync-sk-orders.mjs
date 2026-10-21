import {openDatabase} from '../server/sqlite.ts';
import {syncSkOrders} from '../lib/sk-order-sync.ts';
const path=process.env.CRM_DATABASE_PATH;if(!path)throw Error('CRM_DATABASE_PATH is required');
const db=openDatabase(path);
try{console.log(JSON.stringify(await syncSkOrders(db)));}catch{console.error('SK orders sync failed; see sk-order-health');process.exitCode=1;}finally{db.close();}
