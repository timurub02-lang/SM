import type {ActivityDb as Db} from './activity-store.ts';
// Order allocations are derived from saved orders: retries and CDEK updates cannot double-count.
// ponytail: aggregate views suit this small catalog; materialize balances if order volume demands it.
export const inventorySQL = [
 `CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name_key TEXT UNIQUE NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1)`,
 `CREATE TABLE IF NOT EXISTS stock_movements(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL CHECK(quantity<>0),reason TEXT NOT NULL,actor_id TEXT NOT NULL,at TEXT NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS stock_movements_product ON stock_movements(product_id)`,
 `CREATE VIEW IF NOT EXISTS order_stock AS
 SELECT o.id AS order_id,p.id AS product_id,SUM(json_extract(i.value,'$.quantity')) AS quantity,
 CASE WHEN json_extract(o.data,'$.status')='redeemed' THEN 'sold' ELSE 'reserved' END AS kind
 FROM orders o,json_each(o.data,'$.items') i JOIN products p ON json_extract(p.data,'$.name')=json_extract(i.value,'$.name')
 WHERE (json_extract(o.data,'$.status')<>'refused' OR (json_extract(o.data,'$.delivery')='moscow_courier' AND COALESCE(json_extract(o.data,'$.courier.acceptedAt'),'')<>'' AND COALESCE(json_extract(o.data,'$.warehouseReturnedAt'),'')=''))
 AND NOT(json_extract(o.data,'$.status')='returned' AND COALESCE(json_extract(o.data,'$.warehouseReturnedAt'),'')<>'')
 GROUP BY o.id,p.id`,
 `CREATE TABLE IF NOT EXISTS lv_stock(product_id TEXT PRIMARY KEY REFERENCES products(id),lv_id TEXT UNIQUE NOT NULL,lv_name TEXT NOT NULL,active INTEGER NOT NULL,available INTEGER NOT NULL,applied_quantity INTEGER NOT NULL DEFAULT 0,manual_baseline INTEGER NOT NULL DEFAULT 0,synced_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS lv_stock_operations(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),lv_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity<>0),after_quantity INTEGER NOT NULL,state TEXT NOT NULL,at TEXT NOT NULL,comment TEXT NOT NULL,error TEXT,finished_at TEXT,resolved_by TEXT)`,
 `CREATE INDEX IF NOT EXISTS lv_stock_operations_product ON lv_stock_operations(product_id,state)`,
 `CREATE TABLE IF NOT EXISTS lv_sync_lock(id INTEGER PRIMARY KEY,token TEXT NOT NULL,until_at INTEGER NOT NULL)`,
 `DROP VIEW IF EXISTS product_stock`,
 `CREATE VIEW product_stock AS
 WITH balances AS (
 SELECT p.id,
 COALESCE((SELECT SUM(quantity) FROM stock_movements m WHERE m.product_id=p.id),0)+COALESCE(l.available+l.applied_quantity-l.manual_baseline,0) AS supplied,
 COALESCE((SELECT SUM(quantity) FROM order_stock s WHERE s.product_id=p.id AND s.kind='reserved'),0) AS reserved,
 COALESCE((SELECT SUM(quantity) FROM order_stock s WHERE s.product_id=p.id AND s.kind='sold'),0) AS sold,
 EXISTS(SELECT 1 FROM lv_stock_operations x WHERE x.product_id=p.id AND x.state IN ('sending','unknown')) AS blocked
 FROM products p LEFT JOIN lv_stock l ON l.product_id=p.id)
 SELECT id,supplied,reserved,sold,CASE WHEN blocked THEN -1 ELSE supplied-reserved-sold END AS available,blocked FROM balances`,
 `CREATE TRIGGER IF NOT EXISTS stock_manual_guard BEFORE INSERT ON stock_movements
 WHEN NOT EXISTS(SELECT 1 FROM stock_movements WHERE id=NEW.id)
 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id) THEN RAISE(ABORT,'Товар не найден') END;
 SELECT CASE WHEN NEW.quantity<0 AND -NEW.quantity>(SELECT available FROM product_stock WHERE id=NEW.product_id)
 THEN RAISE(ABORT,'Недостаточно свободного остатка для списания') END;
 END`,
 `CREATE TRIGGER IF NOT EXISTS stock_order_insert AFTER INSERT ON orders BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.data,'$.items') i WHERE NOT EXISTS(SELECT 1 FROM products p WHERE json_extract(p.data,'$.name')=json_extract(i.value,'$.name')))
 THEN RAISE(ABORT,'Выберите товар из складского каталога') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM order_stock s JOIN product_stock p ON p.id=s.product_id WHERE s.order_id=NEW.id AND p.available<0)
 THEN RAISE(ABORT,'Недостаточно товара на складе. Пополните остатки или уменьшите количество') END;
 END`,
 `CREATE TRIGGER IF NOT EXISTS stock_order_update AFTER UPDATE OF data ON orders BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.data,'$.items') i WHERE NOT EXISTS(SELECT 1 FROM products p WHERE json_extract(p.data,'$.name')=json_extract(i.value,'$.name')) AND NOT EXISTS(SELECT 1 FROM json_each(OLD.data,'$.items') old_i WHERE old_i.value=i.value))
 THEN RAISE(ABORT,'Выберите товар из складского каталога') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM order_stock s JOIN product_stock p ON p.id=s.product_id JOIN products product ON product.id=p.id
 WHERE s.order_id=NEW.id AND p.available<0 AND s.quantity>
 CASE WHEN (json_extract(OLD.data,'$.status')='refused' AND NOT(COALESCE(json_extract(OLD.data,'$.delivery'),'')='moscow_courier' AND COALESCE(json_extract(OLD.data,'$.courier.acceptedAt'),'')<>'' AND COALESCE(json_extract(OLD.data,'$.warehouseReturnedAt'),'')='')) OR (json_extract(OLD.data,'$.status')='returned' AND COALESCE(json_extract(OLD.data,'$.warehouseReturnedAt'),'')<>'') THEN 0
 ELSE COALESCE((SELECT SUM(json_extract(i.value,'$.quantity')) FROM json_each(OLD.data,'$.items') i WHERE json_extract(i.value,'$.name')=json_extract(product.data,'$.name')),0) END)
 THEN RAISE(ABORT,'Недостаточно товара на складе. Пополните остатки или уменьшите количество') END;
 END`,
 `CREATE TRIGGER IF NOT EXISTS lv_inactive_order_insert AFTER INSERT ON orders
 WHEN EXISTS(SELECT 1 FROM json_each(NEW.data,'$.items') i JOIN products p ON json_extract(p.data,'$.name')=json_extract(i.value,'$.name') JOIN lv_stock l ON l.product_id=p.id WHERE l.active=0)
 BEGIN SELECT RAISE(ABORT,'Товар отключён в ЛВ'); END`,
 `CREATE TRIGGER IF NOT EXISTS lv_inactive_order_update AFTER UPDATE OF data ON orders
 WHEN EXISTS(SELECT 1 FROM json_each(NEW.data,'$.items') i JOIN products p ON json_extract(p.data,'$.name')=json_extract(i.value,'$.name') JOIN lv_stock l ON l.product_id=p.id
 WHERE l.active=0 AND json_extract(i.value,'$.quantity')>COALESCE((SELECT SUM(json_extract(v.value,'$.quantity')) FROM json_each(OLD.data,'$.items') v WHERE json_extract(v.value,'$.name')=json_extract(i.value,'$.name')),0))
 BEGIN SELECT RAISE(ABORT,'Товар отключён в ЛВ'); END`,
 `CREATE TRIGGER IF NOT EXISTS stock_product_name_guard BEFORE UPDATE OF data ON products
 WHEN json_extract(NEW.data,'$.name')<>json_extract(OLD.data,'$.name') AND EXISTS(SELECT 1 FROM orders o,json_each(o.data,'$.items') i WHERE json_extract(i.value,'$.name')=json_extract(OLD.data,'$.name'))
 BEGIN SELECT RAISE(ABORT,'Нельзя переименовать товар, который уже используется в заказах'); END`,
];

// Versioned in-place upgrade: no stock movements are added or replayed.
export async function migrateCourierStock(d:Db){
 if(await d.prepare("SELECT id FROM settings WHERE id='courier-stock-v1'").first())return;
 const view=inventorySQL.find(sql=>sql.startsWith('CREATE VIEW IF NOT EXISTS order_stock'))!;
 const trigger=inventorySQL.find(sql=>sql.startsWith('CREATE TRIGGER IF NOT EXISTS stock_order_update'))!;
 await d.batch([d.prepare('DROP VIEW IF EXISTS order_stock'),d.prepare(view),d.prepare('DROP TRIGGER IF EXISTS stock_order_update'),d.prepare(trigger),d.prepare("INSERT OR IGNORE INTO settings(id,data) VALUES('courier-stock-v1','{}')")]);
}
