import {db} from './db';
import {inventorySQL} from './inventory-sql';
export async function initInventory(){
 const d=db();
 if(await d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lv_stock'").first())return;
 await d.batch(inventorySQL.map(sql=>d.prepare(sql)));
}
