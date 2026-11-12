import type {ActivityDb} from './activity-store.ts';

// Reservations survive failed saves and deletions; retrying the same SK call keeps its number.
export async function nextOrderId(d:ActivityDb,key:string){
 await d.prepare('CREATE TABLE IF NOT EXISTS order_number_allocations(key TEXT PRIMARY KEY,number INTEGER NOT NULL UNIQUE)').run();
 const row=await d.prepare(`INSERT INTO order_number_allocations(key,number)
 SELECT ?,MAX(COALESCE((SELECT MAX(number) FROM order_number_allocations),0),COALESCE((SELECT MAX(CAST(substr(id,4) AS INTEGER)) FROM orders WHERE (id LIKE 'LV-%' OR id LIKE 'SM-%') AND substr(id,4)<>'' AND substr(id,4) NOT GLOB '*[^0-9]*'),0))+1
 ON CONFLICT(key) DO UPDATE SET key=excluded.key RETURNING number`).bind(key).first();
 if(!row||!Number.isSafeInteger(row.number)||row.number<1)throw Error('Не удалось присвоить номер заказа');
 return 'SM-'+row.number;
}
