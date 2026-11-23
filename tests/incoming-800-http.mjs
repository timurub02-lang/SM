// Real standalone HTTP + Python queue, temporary synthetic databases only.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
const run=promisify(execFile),python=process.platform==='win32'?'python':'python3';
const dir=mkdtempSync(join(tmpdir(),'crm-incoming800-')),path=join(dir,'crm.sqlite'),queue=join(dir,'queue.sqlite'),config=join(dir,'pbx.json');
const db=new DatabaseSync(path),port=process.env.INCOMING_800_TEST_PORT||'3196',base=`http://127.0.0.1:${port}`,key='synthetic-key-800-12345678901234567890';
const script=resolve('scripts/pbx/crm-incoming-800.py');
let server,logs='';
async function stop(){if(server?.exitCode===null){const closed=once(server,'exit');server.kill();await closed;}}
async function start(enabled){
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_DATABASE_PATH:path,HOSTNAME:'127.0.0.1',PORT:port,CRM_INCOMING_800_ENABLED:enabled,CRM_INCOMING_800_KEY:key,CRM_INCOMING_800_NODE:'fixture-pbx',CRM_INCOMING_800_ROUTES:JSON.stringify({megafon:'+78000000001'})},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 for(let i=0;i<150;i++){try{await fetch(base+'/login');return;}catch{if(server.exitCode!==null)break;await new Promise(r=>setTimeout(r,100));}}
 throw Error('Standalone server failed: '+logs);
}
try{
 db.exec(readFileSync('drizzle/0000_cynical_monster_badoon.sql','utf8'));
 for(const sql of authSchema)db.exec(sql);
 await start('0');
 assert.equal((await fetch(base+'/api/telephony/incoming-800',{method:'POST',body:'{}'})).status,404);
 assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='incoming_800_events'").get(),undefined);
 await stop();await start('1');
 assert.equal((await fetch(base+'/api/telephony/incoming-800',{method:'POST',body:'{}'})).status,403);
 writeFileSync(config,JSON.stringify({node:'fixture-pbx',routes:{megafon:'+78000000001'},url:base+'/api/telephony/incoming-800',key}));
 const agi=spawn(python,[script,'agi','megafon','--config',config,'--db',queue],{stdio:['pipe','pipe','pipe']});
 let agiOutput='';agi.stdout.on('data',x=>agiOutput+=x);
 agi.stdin.end('agi_uniqueid: fixture.800\nagi_callerid: 89990000001\n\n200 result=1\n');
 assert.equal((await once(agi,'exit'))[0],0);assert.match(agiOutput,/CRM800_SAVED "1"/);
 const began=performance.now();
 await run(python,[script,'once','--config',config,'--db',queue]);
 const elapsed=Math.round(performance.now()-began);
 const row=db.prepare('SELECT * FROM incoming_calls').get();
 assert.equal(row.phone,'+79990000001');assert.equal(row.shared_queue,1);assert.equal(row.call_count,1);assert.equal(row.source,'asterisk800:megafon');
 assert.equal(db.prepare('SELECT disposition,request_id FROM incoming_800_events').get().request_id,row.id);
 let health=JSON.parse((await run(python,[script,'status','--db',queue])).stdout);
 assert.equal(health.counts.accepted,1);
 // Simulate process death after CRM commit and before local acknowledgement was committed.
 await run(python,['-c',"import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.execute(\"UPDATE queue SET state='pending',receipt=NULL,next_attempt=0\"); d.commit(); d.close()",queue]);
 await run(python,[script,'once','--config',config,'--db',queue]);
 assert.equal(db.prepare('SELECT count(*) n FROM incoming_calls').get().n,1);
 assert.equal(db.prepare('SELECT call_count FROM incoming_calls').get().call_count,1);
 health=JSON.parse((await run(python,[script,'status','--db',queue])).stdout);assert.equal(health.counts.accepted,1);
 console.log(`8-800 standalone + Python AGI/queue: disabled gate, auth, immediate shared callback, durable receipt and lost-ACK replay passed (${elapsed}ms synthetic delivery; not a PBX SLA).`);
}finally{await stop();db.close();rmSync(dir,{recursive:true,force:true});}
