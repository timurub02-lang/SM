// No real LV requests. Exercises inventory SQL and the actual sync with an in-memory upstream.
import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {initLvWarehouse,syncLvWarehouse,resolveLvOperation,withLvLock,fetchLvGoods} from '../lib/lv-warehouse.ts';
const d=openDatabase(':memory:');
await d.prepare('CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT NOT NULL)').run();
await d.prepare('CREATE TABLE orders(id TEXT PRIMARY KEY,data TEXT NOT NULL)').run();
await initLvWarehouse(d);
let upstream={11:{name:'Imported',reserve:'100',used:true,weightInGrams:50,price:{1:990}},12:{name:'Disabled',reserve:'50',used:false}},writes=[],mode='',config={host:'fixture.leadvertex.ru',token:'synthetic',enabled:true,trackCrm:true,links:{}};
const saveConfig=()=>d.prepare("INSERT INTO settings VALUES('lv-warehouse',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify(config)).run();await saveConfig();
const fetcher=async(url,options)=>{
 const path=new URL(url).pathname;
 if(path.includes('getOfferGoods')){if(mode==='read-failure')throw Error('offline');return Response.json(upstream);}
 const body=new URLSearchParams(options.body),id=body.get('goodID'),qty=Number(body.get('quantity'))*(path.includes('reduce')?-1:1);
 assert.equal(options.redirect,'error');writes.push({id,qty,comment:body.get('comment')});assert.match(body.get('comment'),/Операция/);
 if(mode!=='timeout-before')upstream[id].reserve=String(Number(upstream[id].reserve)+qty);
 if(mode==='timeout-before'||mode==='timeout-after')throw Error('lost response');
 return Response.json({[id]:'OK'});
};
const balance=async id=>await d.prepare('SELECT * FROM product_stock WHERE id=?').bind(id).first();
const op=async()=>await d.prepare("SELECT * FROM lv_stock_operations WHERE state='unknown'").first();
const order=async(id,quantity,status='draft',name='Imported',extra={})=>d.prepare('INSERT INTO orders VALUES(?,?)').bind(id,JSON.stringify({items:[{name,quantity}],status,...extra})).run();
const update=async(id,patch)=>{const r=await d.prepare('SELECT data FROM orders WHERE id=?').bind(id).first();await d.prepare('UPDATE orders SET data=? WHERE id=?').bind(JSON.stringify({...JSON.parse(r.data),...patch}),id).run();};
try{
 let result=await syncLvWarehouse(d,fetcher);assert.equal(result.added,1);assert.equal(writes.length,0);
 const product=(await d.prepare('SELECT id FROM products').first()).id;
 assert.equal((await balance(product)).available,100);
 await order('first',3);assert.equal((await balance(product)).available,97);
 await syncLvWarehouse(d,fetcher);assert.equal(Number(upstream[11].reserve),97);assert.equal((await balance(product)).available,97);
 await syncLvWarehouse(d,fetcher);assert.equal(writes.length,1,'No duplicate decrease on pull or retry');
 await update('first',{status:'redeemed'});await syncLvWarehouse(d,fetcher);assert.equal(writes.length,1,'Paid reservation not deducted twice');
 await order('return',2);await syncLvWarehouse(d,fetcher);assert.equal(Number(upstream[11].reserve),95);
 await update('return',{status:'returned'});await syncLvWarehouse(d,fetcher);assert.equal(Number(upstream[11].reserve),95,'Return awaits warehouse acceptance');
 await update('return',{warehouseReturnedAt:new Date().toISOString()});await syncLvWarehouse(d,fetcher);assert.equal(Number(upstream[11].reserve),97);
 await syncLvWarehouse(d,fetcher);assert.equal(Number(upstream[11].reserve),97,'Return cannot double credit');
 await order('cancel',1);await syncLvWarehouse(d,fetcher);await update('cancel',{status:'refused'});await syncLvWarehouse(d,fetcher);assert.equal(Number(upstream[11].reserve),97);
 upstream[11].reserve='90';await syncLvWarehouse(d,fetcher);assert.equal((await balance(product)).available,90,'External LV sale is reflected without a second deduction');
 await d.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?)').bind('manual',product,5,'Receipt','admin',new Date().toISOString()).run();await syncLvWarehouse(d,fetcher);assert.equal(Number(upstream[11].reserve),95);
 config.trackCrm=false;await saveConfig();await order('read-only',2);const before=writes.length;await syncLvWarehouse(d,fetcher);assert.equal(writes.length,before);assert.equal((await balance(product)).available,93);
 config.trackCrm=true;await saveConfig();await syncLvWarehouse(d,fetcher);assert.equal(Number(upstream[11].reserve),93);
 config.enabled=false;await saveConfig();upstream[11].reserve='80';assert.equal((await syncLvWarehouse(d,fetcher)).skipped,true);assert.equal((await balance(product)).available,93);
 config.enabled=true;await saveConfig();await syncLvWarehouse(d,fetcher);assert.equal((await balance(product)).available,80);
 // API lost the reply after applying: freeze new reservations and never blindly repeat.
 await order('timeout',1);mode='timeout-after';await syncLvWarehouse(d,fetcher);assert.equal(Number(upstream[11].reserve),79);assert.equal((await balance(product)).blocked,1);
 const unknown=await op(),count=writes.length;mode='';await syncLvWarehouse(d,fetcher);assert.equal(writes.length,count);
 await assert.rejects(()=>order('blocked',1),/Недостаточно/);
 await resolveLvOperation(d,unknown.id,true,'admin');await syncLvWarehouse(d,fetcher);assert.equal(Number(upstream[11].reserve),79);assert.equal((await balance(product)).available,79);
 // API did not apply: explicit reconciliation permits exactly one retry.
 await order('retry',1);mode='timeout-before';await syncLvWarehouse(d,fetcher);assert.equal(Number(upstream[11].reserve),79);
 await resolveLvOperation(d,(await op()).id,false,'admin');mode='';await syncLvWarehouse(d,fetcher);assert.equal(Number(upstream[11].reserve),78);
 mode='read-failure';await assert.rejects(()=>syncLvWarehouse(d,fetcher));assert.equal((await balance(product)).available,78);mode='';
 // Crash recovery leaves sending operations uncertain, not repeatable.
 await d.prepare("INSERT INTO lv_stock_operations(id,product_id,lv_id,quantity,after_quantity,state,at,comment) VALUES(?,?,?,-1,10,'sending',?,'crashed')").bind(crypto.randomUUID(),product,'11',new Date().toISOString()).run();
 const crashCount=writes.length;await syncLvWarehouse(d,fetcher);assert.equal(writes.length,crashCount);assert.ok(await op());await resolveLvOperation(d,(await op()).id,false,'admin');
 await withLvLock(d,async()=>{await assert.rejects(()=>syncLvWarehouse(d,fetcher),/уже выполняется/);});
 upstream[11].used=false;await syncLvWarehouse(d,fetcher);await assert.rejects(()=>order('inactive',1),/отключён/);assert.ok(await d.prepare('SELECT id FROM products WHERE id=?').bind(product).first());
 // Link a differently named existing product, preserve data, replace manual baseline and account for existing orders once.
 await d.prepare('INSERT INTO products(id,name_key,data) VALUES(?,?,?)').bind('existing','local name',JSON.stringify({name:'Local name',sku:'KEEP',weight:200,cost:123})).run();
 await d.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?)').bind('old-stock','existing',10,'Old stock','admin','2026-01-01').run();
 await order('existing-order',2,'shipping','Local name');
 upstream[13]={name:'External name',reserve:'50',used:true};config.links={'13':'existing'};await saveConfig();
 await syncLvWarehouse(d,fetcher);assert.equal(Number(upstream[13].reserve),48);assert.equal((await balance('existing')).available,48);
 const data=JSON.parse((await d.prepare("SELECT data FROM products WHERE id='existing'").first()).data);assert.equal(data.sku,'KEEP');assert.equal(data.name,'Local name');
 assert.equal((await d.prepare("SELECT COUNT(*) n FROM products WHERE json_extract(data,'$.name')='External name'").first()).n,0);
 await syncLvWarehouse(d,fetcher);assert.equal(Number(upstream[13].reserve),48);
 // Removing credentials preserves quantities and local accounting.
 await d.prepare("DELETE FROM settings WHERE id='lv-warehouse'").run();await order('local-only',1,'draft','Local name');assert.equal((await balance('existing')).available,47);assert.equal((await syncLvWarehouse(d,fetcher)).skipped,true);
 await assert.rejects(()=>fetchLvGoods(config,async()=>Response.json({error:'bad token'})));
 await assert.rejects(()=>fetchLvGoods(config,async()=>Response.json({1:{name:'Bad',reserve:null,used:true}})));
 console.log('LV warehouse: import, mapping, live balances, no double stock, reservations, payments, returns, cancellation, manual stock, switches, lost replies, recovery, lock and local-only transition passed.');
}finally{d.close();}
