import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {openDatabase} from '../server/sqlite.ts';
import {inventorySQL} from '../lib/inventory-sql.ts';
import {syncCdekShipments,applyCdekShipment} from '../lib/cdek-shipment-sync.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-cdek-sync-')),file=join(dir,'crm.sqlite'),db=openDatabase(file);
let calls=[],current=0,peak=0,mode='normal',race;
const at='2026-10-05T12:00:00.000Z';
const row=async id=>{const r=await db.prepare('SELECT data,version FROM orders WHERE id=?').bind(id).first();return {...JSON.parse(r.data),version:r.version};};
const shipment=async id=>{const r=await db.prepare('SELECT data FROM settings WHERE id=?').bind('cdek-shipment-'+id).first();return JSON.parse(r.data);};
const records=new Map();
async function fixture(id,extra={},shipmentExtra={}){
 const uuid=crypto.randomUUID(),o={id,clientId:'c',manager:'op',status:'shipping',delivery:'cdek_pickup',items:[{name:'Goods',quantity:1,price:4990}],createdAt:at,updatedAt:at,contact:'none',due:'',round:1,extra:false,...extra};
 const s={attempt:crypto.randomUUID(),uuid,slot:1,account:'Synthetic',state:'ready',number:'S-'+id,createdAt:at,form:{payment:'cod',deliveryCost:0},...shipmentExtra};
 await db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind(id,'c',JSON.stringify(o)).run();
 await db.prepare('INSERT INTO settings(id,data) VALUES(?,?)').bind('cdek-shipment-'+id,JSON.stringify(s)).run();
 records.set(uuid,{id,status:'DELIVERED'});return {o,s};
}
async function reset(){await db.prepare('DELETE FROM orders').run();await db.prepare('DELETE FROM events').run();await db.prepare("DELETE FROM settings WHERE id LIKE 'cdek-shipment-%'").run();calls=[];records.clear();mode='normal';}
async function request(url,options){
 const path=new URL(url).pathname;calls.push(path);
 if(path==='/v2/oauth/token')return Response.json({access_token:'synthetic'});
 assert.match(path,/^\/v2\/orders\//);assert.equal(options?.method,undefined,'Background reads only');
 const uuid=path.split('/').at(-1),rec=records.get(uuid);assert.ok(rec);
 current++;peak=Math.max(peak,current);await new Promise(r=>setTimeout(r,1));current--;
 if(mode==='outage')return Response.json({errors:[{message:'Outage'}]},{status:503});
 if(mode==='throttle')return Response.json({errors:[{message:'Limit'}]},{status:429});
 if(race){const fn=race;race=undefined;await fn();}
 return Response.json({entity:{uuid,number:mode==='identity'?'OTHER':rec.id,cdek_number:'S-'+rec.id,...(mode==='return-label'?{is_return:true}:{}),statuses:[{code:rec.status,date_time:at}]},requests:[{type:'CREATE',state:'SUCCESSFUL'}]});
}
try{
 for(const sql of readFileSync('drizzle/0000_cynical_monster_badoon.sql','utf8').split('--> statement-breakpoint'))await db.prepare(sql).run();
 await db.batch(inventorySQL.map(sql=>db.prepare(sql)));
 await db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind('c','+79990000001',JSON.stringify({id:'c',name:'Synthetic',owner:'op',sheet:'К'})).run();
 await db.prepare('INSERT INTO products VALUES(?,?,?,?)').bind('p','goods',JSON.stringify({name:'Goods'}),1).run();
 await db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?)').bind('stock','p',1000,'Test','admin',at).run();
 for(const slot of [1,2])await db.prepare('INSERT INTO settings VALUES(?,?)').bind('cdek-'+slot,JSON.stringify({clientId:'synthetic',clientSecret:'synthetic'})).run();
 await db.prepare('INSERT INTO settings VALUES(?,?)').bind('cdek-status-mapping',JSON.stringify({mapping:{CREATED:'sent',DELIVERED:'paid'},revision:'1'})).run();
 for(let i=0;i<100;i++)await fixture('SM-'+i,{}, {slot:i%2+1});
 assert.deepEqual(await syncCdekShipments(db,request),{checked:100,changed:100,failed:0});
 assert.equal(calls.filter(x=>x==='/v2/oauth/token').length,2);assert.equal(peak,4);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM orders WHERE json_extract(data,'$.status')='redeemed'").first()).n,100);
 assert.equal((await db.prepare('SELECT sold FROM product_stock').first()).sold,100);
 assert.deepEqual(await syncCdekShipments(db,request),{checked:0,changed:0,failed:0});
 console.log('100 shipments updated without cards; two tokens, four concurrent requests; stock and terminal exclusion passed.');
 await reset();const unknown=await fixture('UNKNOWN');records.get(unknown.s.uuid).status='NOT_DELIVERED';
 await syncCdekShipments(db,request);assert.equal((await row('UNKNOWN')).status,'shipping');assert.equal((await row('UNKNOWN')).cdekStatus.code,'NOT_DELIVERED');
 const events=(await db.prepare('SELECT COUNT(*) n FROM events').first()).n;
 assert.equal((await syncCdekShipments(db,request)).changed,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM events').first()).n,events);
 await reset();await fixture('RETRY');mode='outage';assert.equal((await syncCdekShipments(db,request)).failed,1);assert.equal((await row('RETRY')).status,'shipping');assert.ok((await shipment('RETRY')).syncError);
 mode='identity';assert.equal((await syncCdekShipments(db,request)).failed,1);assert.equal((await row('RETRY')).status,'shipping');
 mode='return-label';assert.equal((await syncCdekShipments(db,request)).changed,0);assert.equal((await row('RETRY')).status,'shipping');
 mode='normal';await syncCdekShipments(db,request);assert.equal((await row('RETRY')).status,'redeemed');assert.equal((await shipment('RETRY')).syncError,undefined);
 await reset();await fixture('DELETING',{}, {state:'deleting'});await fixture('INVALID',{}, {state:'invalid'});await fixture('NO-UUID',{}, {uuid:undefined});await fixture('TEST',{testOnly:true});await fixture('RETURNED',{status:'returned'});await fixture('CANCELLED',{status:'refused'});assert.equal((await syncCdekShipments(db,request)).checked,0);assert.equal(calls.length,0);
 await reset();await fixture('RACE');race=async()=>{const s=await shipment('RACE');await db.prepare('UPDATE settings SET data=? WHERE id=?').bind(JSON.stringify({...s,state:'deleting'}),'cdek-shipment-RACE').run();};assert.equal((await syncCdekShipments(db,request)).failed,1);assert.equal((await row('RACE')).status,'shipping');assert.equal((await shipment('RACE')).state,'deleting');
 await reset();await fixture('EDIT');race=async()=>{await db.prepare("UPDATE orders SET data=json_set(data,'$.comment','newer edit'),version=version+1 WHERE id='EDIT'").run();};assert.equal((await syncCdekShipments(db,request)).failed,1);assert.equal((await row('EDIT')).status,'shipping');assert.equal((await row('EDIT')).comment,'newer edit');assert.equal((await db.prepare('SELECT COUNT(*) n FROM events').first()).n,0);
 await reset();const atomic=await fixture('ATOMIC');const previous=JSON.stringify(atomic.s);await db.prepare("CREATE TRIGGER test_event_failure BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END").run();
 const answer=await (await request('https://api.cdek.ru/v2/orders/'+atomic.s.uuid,{})).json();await assert.rejects(applyCdekShipment(db,await row('ATOMIC'),atomic.s,previous,answer));assert.equal((await row('ATOMIC')).status,'shipping');assert.equal(JSON.stringify(await shipment('ATOMIC')),previous);await db.prepare('DROP TRIGGER test_event_failure').run();
 console.log('Unknown mappings, no duplicates, outage recovery, identity, return labels, deletion/edit races and atomic rollback passed.');
 await reset();for(let i=0;i<205;i++)await fixture('Q-'+String(i).padStart(3,'0'));mode='outage';assert.equal((await syncCdekShipments(db,request)).failed,200);mode='normal';const count=await syncCdekShipments(db,request);assert.equal(count.checked,200);for(let i=200;i<205;i++)assert.equal((await row('Q-'+i)).status,'redeemed');
 await reset();for(let i=0;i<20;i++)await fixture('LIMIT-'+i);mode='throttle';assert.equal((await syncCdekShipments(db,request)).failed,20);assert.ok(calls.filter(x=>x.startsWith('/v2/orders/')).length<=4);
 console.log('Bounded queue, failure fairness and rate-limit backoff passed.');
 await reset();const cli=await fixture('CLI');const fixtureFile=join(dir,'upstream.json');writeFileSync(fixtureFile,JSON.stringify({orders:{[cli.s.uuid]:{number:'CLI',cdek_number:'S-CLI',status:'DELIVERED'}},calls:[]}));
 const child=spawnSync(process.execPath,['--experimental-strip-types','--import',resolve('tests/fixtures/cdek-fetch.mjs'),resolve('scripts/sync-cdek-shipments.mjs')],{env:{...process.env,CRM_DATABASE_PATH:file,CDEK_TEST_FIXTURE:fixtureFile},encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout.trim()).changed,1);assert.equal((await row('CLI')).status,'redeemed');
 console.log('Standalone background script updated a shipment with no web server or browser running.');
}finally{db.close();rmSync(dir,{recursive:true,force:true});}
