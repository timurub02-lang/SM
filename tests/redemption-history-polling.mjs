import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {initRedemption} from '../lib/redemption.ts';
const d=openDatabase(':memory:');
try{
 await d.batch(['CREATE TABLE orders(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT)',
  'CREATE TABLE redemption_entries(order_id TEXT PRIMARY KEY,entered_at TEXT,data TEXT,version INTEGER DEFAULT 1)',
  'CREATE TABLE redemption_history(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id TEXT,at TEXT,data TEXT)',
  "CREATE TRIGGER redemption_history_update AFTER UPDATE OF data ON redemption_entries WHEN NEW.data<>OLD.data BEGIN INSERT INTO redemption_history(order_id,at,data) VALUES(NEW.order_id,'old',NEW.data); END"
 ].map(sql=>d.prepare(sql)));
 await initRedemption(d);
 await d.prepare("INSERT INTO redemption_entries VALUES('one','2026-11-17','{}',1)").run();
 let data={result:'to_return',changeKind:'return_check',changedBy:'API',updatedAt:'2026-11-18T00:00:00Z',returnCheck:{state:'pending',at:'2026-11-18T00:00:00Z'}};
 const save=()=>d.prepare("UPDATE redemption_entries SET data=?,version=version+1 WHERE order_id='one'").bind(JSON.stringify(data)).run();
 const count=async()=>(await d.prepare('SELECT count(*) n FROM redemption_history').first()).n;
 await save();assert.equal(await count(),1,'First pending check is recorded');
 data={...data,updatedAt:'2026-11-18T00:01:00Z',returnCheck:{state:'pending',at:'2026-11-18T00:01:00Z'}};
 await save();assert.equal(await count(),1,'Same check with newer timestamps is not another business event');
 assert.equal(JSON.parse((await d.prepare('SELECT data FROM redemption_entries').first()).data).returnCheck.at,data.updatedAt,'Polling order still advances');
 data={...data,returnCheck:{...data.returnCheck,state:'error',error:'Unavailable'}};await save();assert.equal(await count(),2);
 data={...data,returnCheck:{...data.returnCheck,error:'Different error'}};await save();assert.equal(await count(),3);
 data={...data,changeKind:'verify_return_api',result:'returned',returnCheck:{state:'verified',at:data.updatedAt}};await save();assert.equal(await count(),4);
 data={...data,changeKind:'action',updatedAt:'2026-11-18T00:02:00Z'};await save();
 data={...data,updatedAt:'2026-11-18T00:03:00Z'};await save();assert.equal(await count(),6,'Distinct operator actions are retained');
 console.log('History trigger upgrade: duplicate check timestamps suppressed; changed errors, verification and operator actions retained');
}finally{d.close();}
