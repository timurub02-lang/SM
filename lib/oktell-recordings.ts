import {mkdir,open,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ActivityDb} from './activity-store.ts';
import {pilotControl} from './oktell-pilot-control.ts';
import {initPhone} from './phone-store.ts';

export async function saveOktellRecording(id:string,info:any,dir:string,download:typeof fetch=fetch){
 if(!/^[a-f0-9]{32}$/.test(id)||!info||!['wav','mp3'].includes(info.extension)||typeof info.url!=='string')throw Error('Invalid recording metadata');
 const url=new URL(info.url,'http://10.21.103.2:4055');
 if(url.origin!=='http://10.21.103.2:4055'||url.username||url.password||url.search||url.hash||!/^\/download\/rec\/[A-Za-z0-9_+=-]{1,2048}$/.test(url.pathname))throw Error('Invalid recording origin');
 const limit=32*1024*1024;
 const response=await download(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
 if(response.status!==200||!response.body||Number(response.headers.get('content-length'))>limit)throw Error('Recording download unavailable');
 await mkdir(dir,{recursive:true,mode:0o750});
 const target=join(dir,id+'.'+info.extension),temp=target+'.'+randomUUID()+'.tmp';
 const file=await open(temp,'wx',0o640),reader=response.body.getReader();let size=0,signature=Buffer.alloc(0);
 try{
  while(true){
   const {value:chunk,done}=await reader.read();if(done)break;
   size+=chunk.length;if(size>limit)throw Error('Recording too large');
   if(signature.length<12)signature=Buffer.concat([signature,Buffer.from(chunk).subarray(0,12-signature.length)]);
   let written=0;while(written<chunk.length){const r=await file.write(chunk,written,chunk.length-written);if(!r.bytesWritten)throw Error('Recording write failed');written+=r.bytesWritten;}
  }
  const wav=signature.toString('ascii',0,4)==='RIFF'&&signature.toString('ascii',8,12)==='WAVE';
  const mp3=signature.toString('ascii',0,3)==='ID3'||signature[0]===255&&(signature[1]&0xe0)===0xe0;
  const length=response.headers.get('content-length');
  if(size<12||length!==null&&Number(length)!==size||info.extension==='wav'&&!wav||info.extension==='mp3'&&!mp3)throw Error('Invalid recording audio');
  await file.sync();await file.close();await rename(temp,target);
 }catch(e){await reader.cancel().catch(()=>{});await file.close().catch(()=>{});await unlink(temp).catch(()=>{});throw e;}finally{reader.releaseLock();}
}

export async function syncOktellRecordings(d:ActivityDb,request:typeof pilotControl=pilotControl,save=saveOktellRecording){
 await initPhone(d);
 await d.prepare('CREATE TABLE IF NOT EXISTS oktell_recording_sync(call_id TEXT PRIMARY KEY,attempted_at TEXT NOT NULL)').run();
 const rows=(await d.prepare(`SELECT c.id FROM phone_calls c LEFT JOIN oktell_recording_sync s ON s.call_id=c.id
  WHERE c.recording=0 AND c.answered_at IS NOT NULL AND c.ended_at IS NOT NULL AND c.detail LIKE 'Т1 · %'
  AND (s.attempted_at IS NULL OR s.attempted_at<datetime('now','-15 minutes'))
  ORDER BY COALESCE(s.attempted_at,''),c.started_at LIMIT 5`).all()).results;
 let saved=0,failed=0;
 for(const c of rows){
  await d.prepare("INSERT INTO oktell_recording_sync(call_id,attempted_at) VALUES(?,datetime('now')) ON CONFLICT(call_id) DO UPDATE SET attempted_at=excluded.attempted_at").bind(c.id).run();
  try{
   const chain=c.id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
   const info=await request('/pilot-recording?chain='+chain);
   await save(c.id,info,process.env.CRM_PHONE_RECORDINGS_DIR||'/var/lib/sm-crm/recordings');
   await d.prepare('UPDATE phone_calls SET recording=1 WHERE id=?').bind(c.id).run();saved++;
  }catch{failed++;}
 }
 const pending=Number((await d.prepare("SELECT COUNT(*) n FROM phone_calls WHERE recording=0 AND answered_at IS NOT NULL AND ended_at IS NOT NULL AND detail LIKE 'Т1 · %'").first())?.n||0);
 const result={ok:pending===0,at:new Date().toISOString(),saved,failed,pending};
 await d.prepare("INSERT INTO settings(id,data) VALUES('oktell-recording-health',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify(result)).run();
 return result;
}
