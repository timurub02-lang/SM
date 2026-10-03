import {openDatabase} from '../server/sqlite.ts';
import {reconcileOrderTimers,reconcileClients} from '../lib/base-retention-store.ts';
import {runBaseDispatch} from '../lib/base-dispatch.ts';
const path=process.env.CRM_DATABASE_PATH;if(!path)throw Error('CRM_DATABASE_PATH is required');
const db=openDatabase(path);
try{
 const read=async(table)=> (await db.prepare(`SELECT data,version FROM ${table}`).all()).results.map(r=>({...JSON.parse(r.data),version:r.version}));
 let orders=await read('orders');const events=(await db.prepare("SELECT data FROM events WHERE data LIKE '%Возврат оператору%' ORDER BY at DESC").all()).results.map(r=>JSON.parse(r.data));
 if(await reconcileOrderTimers(db,orders,events))orders=await read('orders');
 const clients=(await db.prepare("SELECT data,version FROM clients WHERE COALESCE(json_extract(data,'$.owner'),'')<>'' OR EXISTS(SELECT 1 FROM orders WHERE orders.client_id=clients.id AND json_extract(orders.data,'$.pv')=1)").all()).results.map(r=>({...JSON.parse(r.data),version:r.version}));
 await reconcileClients(db,clients,orders);
 const result=await runBaseDispatch(db);await db.prepare("INSERT INTO settings(id,data) VALUES('base-health',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify({state:'ok',at:new Date().toISOString()})).run();console.log(JSON.stringify(result));
}catch(e){await db.prepare("INSERT INTO settings(id,data) VALUES('base-health',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify({state:'error',at:new Date().toISOString(),error:e instanceof Error?e.message:'Ошибка проверки расписания'})).run();console.error('Base dispatch failed; see CRM base health');process.exitCode=1;}finally{db.close();}
