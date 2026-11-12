import {openDatabase} from '../server/sqlite.ts';
import {syncSkOrders} from '../lib/sk-order-sync.ts';
const path=process.env.CRM_DATABASE_PATH;if(!path)throw Error('CRM_DATABASE_PATH is required');
const db=openDatabase(path),once=process.argv.includes('--once');let stopping=false;
process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
try{
 do{
  const started=performance.now();
  try{const result=await syncSkOrders(db,fetch,Date.now(),undefined,true);if(result.imported||result.pending)console.log(JSON.stringify({...result,durationMs:Math.round(performance.now()-started)}));}
  catch{console.error('SK event processing failed; queued events retained');if(once)process.exitCode=1;}
  if(!once&&!stopping)await new Promise(resolve=>setTimeout(resolve,Math.max(0,1000-(performance.now()-started))));
 }while(!once&&!stopping);
}finally{db.close();}
