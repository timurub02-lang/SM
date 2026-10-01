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
 WHERE json_extract(o.data,'$.status')<>'refused'
 AND NOT(json_extract(o.data,'$.status')='returned' AND COALESCE(json_extract(o.data,'$.warehouseReturnedAt'),'')<>'')
 GROUP BY o.id,p.id`,
 `CREATE VIEW IF NOT EXISTS product_stock AS
 SELECT p.id,
 COALESCE((SELECT SUM(quantity) FROM stock_movements m WHERE m.product_id=p.id),0) AS supplied,
 COALESCE((SELECT SUM(quantity) FROM order_stock s WHERE s.product_id=p.id AND s.kind='reserved'),0) AS reserved,
 COALESCE((SELECT SUM(quantity) FROM order_stock s WHERE s.product_id=p.id AND s.kind='sold'),0) AS sold,
 COALESCE((SELECT SUM(quantity) FROM stock_movements m WHERE m.product_id=p.id),0)-COALESCE((SELECT SUM(quantity) FROM order_stock s WHERE s.product_id=p.id),0) AS available
 FROM products p`,
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
 CASE WHEN json_extract(OLD.data,'$.status')='refused' OR (json_extract(OLD.data,'$.status')='returned' AND COALESCE(json_extract(OLD.data,'$.warehouseReturnedAt'),'')<>'') THEN 0
 ELSE COALESCE((SELECT SUM(json_extract(i.value,'$.quantity')) FROM json_each(OLD.data,'$.items') i WHERE json_extract(i.value,'$.name')=json_extract(product.data,'$.name')),0) END)
 THEN RAISE(ABORT,'Недостаточно товара на складе. Пополните остатки или уменьшите количество') END;
 END`,
 `CREATE TRIGGER IF NOT EXISTS stock_product_name_guard BEFORE UPDATE OF data ON products
 WHEN json_extract(NEW.data,'$.name')<>json_extract(OLD.data,'$.name') AND EXISTS(SELECT 1 FROM orders o,json_each(o.data,'$.items') i WHERE json_extract(i.value,'$.name')=json_extract(OLD.data,'$.name'))
 BEGIN SELECT RAISE(ABORT,'Нельзя переименовать товар, который уже используется в заказах'); END`,
];
