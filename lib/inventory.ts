import {db} from './db';
import {inventorySQL,migrateCourierStock} from './inventory-sql';
export async function initInventory(){
 const d=db();
 if(!await d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lv_stock'").first())await d.batch(inventorySQL.map(sql=>d.prepare(sql)));
 await migrateCourierStock(d);
}
