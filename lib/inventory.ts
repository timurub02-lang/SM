import {db} from './db';
import {inventorySQL} from './inventory-sql';
export async function initInventory(){
 const d=db();
 if(await d.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='stock_product_name_guard'").first())return;
 await d.batch(inventorySQL.map(sql=>d.prepare(sql)));
}
