import {rename,unlink,chmod,readdir,lstat,statfs} from 'node:fs/promises';
import {join} from 'node:path';
import {openDatabase} from '../server/sqlite.ts';
import {claimExport,finishExport,exportScope,mayExport,initExportJobs} from '../lib/export-jobs.ts';
import {prepareExportDirectory,exportFile,removeExportFile} from '../lib/export-files.ts';
import {baseWorkbook} from '../lib/base-export.ts';
import {readPremiumStateFrom} from '../lib/premium-read.ts';
import {premiumPeriods} from '../lib/premium-periods.ts';
import {premiumWorkbook} from '../lib/premium-export.ts';
import {ledgerRows,periodOrders} from '../lib/premium-ledger.ts';
const path=process.env.CRM_DATABASE_PATH;if(!path)throw Error('CRM_DATABASE_PATH is required');
const d=openDatabase(path),started=performance.now();let snapshot,job,temp;
// A hard process deadline is shorter than the lease: a stalled renderer cannot overlap its retry.
const deadline=setTimeout(()=>process.exit(1),120000);deadline.unref();
let heartbeat;
try{
 await initExportJobs(d);const directory=await prepareExportDirectory();
 const health=()=>d.prepare('INSERT INTO crm_export_health(id,at) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET at=excluded.at').bind(Date.now()).run();
 await health();heartbeat=setInterval(()=>{void health().catch(()=>{});},5000);
 for(const row of (await d.prepare('SELECT id,claim FROM crm_export_jobs WHERE expires_at<=?').bind(Date.now()).all()).results){await removeExportFile(row.id,row.claim);await d.prepare('DELETE FROM crm_export_jobs WHERE id=? AND expires_at<=?').bind(row.id,Date.now()).run();}
 for(const name of await readdir(directory)){if(!/^[a-f0-9-]{36}\.[a-f0-9-]{36}\.(tmp|xlsx)$/.test(name))continue;const file=join(directory,name),stat=await lstat(file);if(stat.isFile()&&Date.now()-stat.mtimeMs>(name.endsWith('.tmp')?180000:86400000))await unlink(file);}
 job=await claimExport(d);
 if(job){
  const disk=await statfs(directory);if(disk.bavail*disk.bsize<512*1024*1024)throw Error('Insufficient export disk space');
  snapshot=openDatabase(path);await snapshot.prepare('BEGIN').run();
  const row=await snapshot.prepare('SELECT e.data FROM employees e JOIN auth_accounts a ON a.employee_id=e.id LEFT JOIN auth_test_accounts t ON t.employee_id=e.id WHERE e.id=? AND a.enabled=1 AND t.employee_id IS NULL').bind(job.actor_id).first(),actor=row&&JSON.parse(row.data);
  if(!actor||!mayExport(actor,job.kind)||exportScope(actor)!==job.scope)throw Error('Export access changed');
  temp=exportFile(job.id,job.claim,true);
  if(job.kind==='base')await baseWorkbook(snapshot,job.parameter,temp);
  else{
   const calendar=premiumPeriods.find(p=>p.id===job.parameter),s=await readPremiumStateFrom(snapshot,job.parameter);
   if(!calendar||!s.ledger)throw Error('Premium unavailable');
   const ledger={...s.ledger,periods:{...s.ledger.periods,[job.parameter]:s.ledger.periods[job.parameter]||{status:'open',signatures:{}}}};
   const book=await premiumWorkbook(actor,job.parameter,calendar.label,ledger.periods[job.parameter],ledgerRows(ledger,job.parameter,s.orders,s.employees,s.adjustments),periodOrders(ledger,job.parameter,s.orders,s.employees));
   await book.xlsx.writeFile(temp);
  }
  await snapshot.prepare('COMMIT').run();snapshot.close();snapshot=undefined;
  await chmod(temp,0o600);await rename(temp,exportFile(job.id,job.claim));temp=undefined;
  if(!await finishExport(d,job,true))await removeExportFile(job.id,job.claim);
 }
 await health();console.log(JSON.stringify({processed:!!job,durationMs:Math.round(performance.now()-started),maxRssKiB:process.resourceUsage().maxRSS}));
}catch{
 if(job)await finishExport(d,job,false).catch(()=>{});
 console.error('CRM export failed; task status contains a safe error');process.exitCode=1;
}finally{
 clearTimeout(deadline);clearInterval(heartbeat);snapshot?.close();
 if(temp)await unlink(temp).catch(()=>{});d.close();
}
