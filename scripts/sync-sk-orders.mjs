import {openDatabase} from '../server/sqlite.ts';
import {syncLvIncoming} from '../lib/lv-incoming-sync.ts';
import {syncSkOrders} from '../lib/sk-order-sync.ts';
const path=process.env.CRM_DATABASE_PATH;if(!path)throw Error('CRM_DATABASE_PATH is required');
const db=openDatabase(path);
try{
 for(const sync of [syncLvIncoming,syncSkOrders]){
  try{console.log(JSON.stringify(await sync(db)));}catch{console.error(sync.name+' failed; see integration health');process.exitCode=1;}
 }
}finally{db.close();}
