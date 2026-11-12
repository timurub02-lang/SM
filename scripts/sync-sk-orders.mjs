import {openDatabase} from '../server/sqlite.ts';
import {syncSkOrders} from '../lib/sk-order-sync.ts';
const path=process.env.CRM_DATABASE_PATH;if(!path)throw Error('CRM_DATABASE_PATH is required');
const db=openDatabase(path);
try{
 try{console.log(JSON.stringify(await syncSkOrders(db)));}catch{
  try{const row=await db.prepare("SELECT data FROM settings WHERE id='sk-order-health'").first();const failure=JSON.parse(row?.data||'{}').lastFailure;console.error(JSON.stringify({job:'sk-orders',ok:false,...(failure?{lastFailure:{at:failure.at,stage:failure.stage,category:failure.category,status:failure.status}}:{})}));}
  catch{console.error('SK reconciliation failed; integration health unavailable');}
  process.exitCode=1;
 }
}finally{db.close();}
