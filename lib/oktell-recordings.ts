import recordingFile from '../scripts/oktell-bridge/recording-file.mjs';
import type {ActivityDb} from './activity-store.ts';
import {pilotControl} from './oktell-pilot-control.ts';
import {initPhone} from './phone-store.ts';

export const saveOktellRecording=recordingFile.saveOktellRecording;

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
