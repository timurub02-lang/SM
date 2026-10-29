import {z} from 'zod';
import type {ActivityDb} from './activity-store.ts';
import {syncPilot} from './oktell-pilot-sync.ts';
import {pilotControl} from './oktell-pilot-control.ts';
import {pilotSetting} from './oktell-pilot.ts';
const cursorKey='oktell-history-cursor';
const batchSchema=z.object({after:z.number().int().nonnegative(),through:z.number().int().nonnegative(),calls:z.array(z.object({seq:z.number().int().positive()}).passthrough()).max(100)});
export async function syncOktellBackground(d:ActivityDb,request:typeof pilotControl=pilotControl){
 const configured=await d.prepare('SELECT data FROM settings WHERE id=?').bind(pilotSetting).first();
 if(!configured||!JSON.parse(configured.data).native)return {calls:0};
 const row=await d.prepare('SELECT data FROM settings WHERE id=?').bind(cursorKey).first();
 let after=row?z.number().int().nonnegative().parse(JSON.parse(row.data)):0,total=0;
 // Each run is bounded; a later run resumes after the last fully saved batch.
 for(let page=0;page<10;page++){
  const b=batchSchema.parse(await request('/pilot-changes?after='+after));
  if(b.after!==after||b.through<after||b.calls.some((c,i)=>c.seq<=(i?b.calls[i-1].seq:after))||b.through!==(b.calls.at(-1)?.seq??after))throw Error('Некорректная позиция журнала Oktell');
  if(!b.calls.length)break;
  await syncPilot(d,b.calls);
  // A crash before this write replays idempotent call updates rather than skipping them.
  await d.prepare('INSERT INTO settings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE CAST(settings.data AS INTEGER)<CAST(excluded.data AS INTEGER)').bind(cursorKey,JSON.stringify(b.through)).run();
  after=b.through;total+=b.calls.length;
 }
 return {calls:total,through:after};
}
