import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {initialBaseSettings,baseSettingsSchema} from '../lib/base-policy.ts';
import {readBaseDestination,saveBaseDestination} from '../lib/base-destination.ts';
import {queueBaseDispatch,runBaseDispatch} from '../lib/base-dispatch.ts';
const d=openDatabase(':memory:');
try{
 await d.prepare('CREATE TABLE clients(id TEXT PRIMARY KEY,phone TEXT UNIQUE,data TEXT,version INTEGER DEFAULT 1)').run();
 await d.prepare('CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT)').run();
 assert.equal((await readBaseDestination(d)).config.dispatchTarget,'skorozvon');
 const legacy=initialBaseSettings();delete legacy.dispatchTarget;
 assert.equal(baseSettingsSchema.parse(legacy).dispatchTarget,'skorozvon');
 const config=initialBaseSettings();Object.assign(config.M.sheets.find(s=>s.name==='Т1'),{automatic:true,projectId:'123',cycleDays:1});
 await d.prepare('INSERT INTO settings VALUES(?,?)').bind('base-settings',JSON.stringify({config,revision:'first'})).run();
 await d.prepare('INSERT INTO settings VALUES(?,?)').bind('skorozvon','{}').run();
 for(let i=0;i<2;i++)await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind('c'+i,'7999000000'+i,JSON.stringify({id:'c'+i,phone:'7999000000'+i,owner:'',baseType:'M',sheet:'Т1'})).run();
 const now=new Date('2026-10-26T18:01:00Z');
 await queueBaseDispatch(d,{base:'M',sheet:'Т1',project:'123',count:1},now);
 const saved=await saveBaseDestination(d,'oktell','first');assert(saved);assert.equal(saved.config.dispatchTarget,'oktell');
 assert.deepEqual(saved.config.M,config.M);assert.deepEqual(saved.config.retention,config.retention);
 assert.equal(await saveBaseDestination(d,'skorozvon','first'),null);
 await assert.rejects(()=>saveBaseDestination(d,'both',saved.revision));
 await assert.rejects(()=>queueBaseDispatch(d,{base:'M',sheet:'Т1',project:'123',count:1},now),/Oktell/);
 const noNetwork=async()=>{assert.fail('No network when Oktell is selected');};
 assert.equal((await runBaseDispatch(d,noNetwork,now)).paused,true);
 assert.equal((await d.prepare('SELECT count(*) AS n FROM base_dispatch_jobs').first()).n,1);
 assert.equal((await d.prepare("SELECT count(*) AS n FROM base_dispatch_items WHERE state='pending'").first()).n,1);
 assert.equal((await d.prepare("SELECT count(*) AS n FROM clients WHERE json_extract(data,'$.distributedAt') IS NOT NULL").first()).n,0);
 const restored=await saveBaseDestination(d,'skorozvon',saved.revision);assert(restored);
 // Switch during the first external write: it finishes, subsequent items must wait.
 let switched=false,clientWrites=0;
 const request=async(url,options)=>{
  if(url.includes('oauth'))return Response.json({access_token:'fixture'});
  if(options.method==='GET')return Response.json([]);
  clientWrites++;
  if(!switched){switched=true;assert(await saveBaseDestination(d,'oktell',restored.revision));}
  return Response.json({id:123});
 };
 const result=await runBaseDispatch(d,request,now);assert.equal(result.sent,1);assert.equal(result.paused,true);assert.equal(clientWrites,1);
 assert.equal((await d.prepare("SELECT count(*) AS n FROM base_dispatch_items WHERE state='pending'").first()).n,1);
 console.log('Base destination: default, persistence, unchanged sheet settings, stale writes, manual/automatic pause, pending preservation and switch during delivery passed');
}finally{d.close();}
