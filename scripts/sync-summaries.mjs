import {openDatabase} from '../server/sqlite.ts';
import {createSummaryWorker,renewSummaryLease,releaseSummaryLease} from '../lib/crm-summary-worker.ts';
const path=process.env.CRM_DATABASE_PATH;if(!path)throw Error('CRM_DATABASE_PATH is required');
const writer=openDatabase(path),reader=openDatabase(path),once=process.argv.includes('--once');
let stopping=false,heartbeat,busy=false,worker;
process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
try{
 worker=await createSummaryWorker(writer,reader);
 heartbeat=setInterval(async()=>{if(busy)return;busy=true;try{await renewSummaryLease(writer,worker.token);}catch{}finally{busy=false;}},3000);
 do{
  const started=performance.now();
  try{const result=await worker.tick();if(once||!result.published)console.log(JSON.stringify({...result,durationMs:Math.round(performance.now()-started)}));}
  catch(error){await writer.prepare("UPDATE crm_model_worker SET ok=0,message='Ошибка расчёта. Сохранена последняя готовая сводка.' WHERE id=1 AND token=?").bind(worker.token).run();console.error('CRM summaries failed:',error instanceof Error?error.message:'unknown error');if(once){process.exitCode=1;break;}}
  if(!once&&!stopping)await new Promise(resolve=>setTimeout(resolve,Math.max(0,1000-(performance.now()-started))));
 }while(!once&&!stopping);
}finally{clearInterval(heartbeat);while(busy)await new Promise(resolve=>setTimeout(resolve,10));if(worker)await releaseSummaryLease(writer,worker.token);reader.close();writer.close();}
