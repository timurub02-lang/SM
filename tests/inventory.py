"""Run: python3 tests/inventory.py. Exercises the actual SQLite constraints/views."""
import json
import sqlite3
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sql = json.loads(subprocess.check_output(['node', '--experimental-strip-types', '--input-type=module', '-e', "import {inventorySQL} from './lib/inventory-sql.ts';console.log(JSON.stringify(inventorySQL))"], cwd=root, text=True))
db = sqlite3.connect(':memory:', isolation_level=None)
db.execute('PRAGMA foreign_keys=ON')
db.execute('CREATE TABLE orders(id TEXT PRIMARY KEY,data TEXT NOT NULL)')
for statement in sql:
    db.execute(statement)
def product(id, name):
    db.execute('INSERT INTO products(id,name_key,data) VALUES(?,?,?)', (id, name.lower(), json.dumps({'name':name})))
product('shoes', 'Кроссовки')
product('bag', 'Сумка')
def move(id, quantity, product='shoes'):
    db.execute('INSERT OR IGNORE INTO stock_movements VALUES(?,?,?,?,?,?)', (id, product, quantity, 'Проверка', 'admin', '2026-09-30'))
def order(id, qty, status='draft', name='Кроссовки'):
    data={'status':status,'items':[{'name':name,'quantity':qty}]}
    db.execute('INSERT INTO orders VALUES(?,?)', (id,json.dumps(data)))
def update(id, **changes):
    data=json.loads(db.execute('SELECT data FROM orders WHERE id=?',(id,)).fetchone()[0]);data.update(changes)
    db.execute('UPDATE orders SET data=? WHERE id=?',(json.dumps(data),id))
def stock(product='shoes'):
    return db.execute('SELECT available,reserved,sold FROM product_stock WHERE id=?',(product,)).fetchone()
def fails(fn, message):
    try: fn()
    except sqlite3.IntegrityError as e: assert message in str(e), str(e)
    else: raise AssertionError('Expected rejection: '+message)

fails(lambda:order('no-stock',1), 'Недостаточно товара')
assert db.execute('SELECT COUNT(*) FROM orders').fetchone()[0]==0
move('receipt',10);move('receipt',10)
assert stock()==(10,0,0), 'Receipt retry must not add twice'
order('one',3)
assert stock()==(7,3,0)
for status in ['confirm','check','extra','packing','shipping','pickup']:
    update('one',status=status)
    assert stock()==(7,3,0)
update('one',status='redeemed');update('one',status='redeemed')
assert stock()==(7,0,3)
update('one',status='returned')
assert stock()==(7,3,0), 'A return cannot be sold again before arrival'
update('one',warehouseReturnedAt='2026-09-30');update('one',warehouseReturnedAt='2026-09-30')
assert stock()==(10,0,0)
order('two',2);update('two',status='refused')
assert stock()==(10,0,0)
update('two',status='draft',items=[{'name':'Кроссовки','quantity':2},{'name':'Кроссовки','quantity':3}])
assert stock()==(5,5,0), 'Duplicate basket rows must sum'
move('remove',-5)
assert stock()==(0,5,0)
fails(lambda:move('remove-too-many',-1), 'Недостаточно свободного')
fails(lambda:update('two',items=[{'name':'Кроссовки','quantity':6}]), 'Недостаточно товара')
assert stock()==(0,5,0), 'Failed update must preserve old reservation'
update('two',items=[{'name':'Кроссовки','quantity':1}])
assert stock()==(4,1,0)
move('bag-receipt',2,'bag')
update('two',items=[{'name':'Сумка','quantity':2}])
assert stock()==(5,0,0) and stock('bag')==(0,2,0)
fails(lambda:order('unknown',1,name='Неизвестный'), 'Выберите товар')
fails(lambda:db.execute("UPDATE products SET data=? WHERE id='shoes'",(json.dumps({'name':'Другое'}),)), 'Нельзя переименовать')
# Two requests may read the same free balance: the second write still cannot overbook.
order('last-stock',5)
fails(lambda:order('stale-request',1), 'Недостаточно товара')
assert stock()==(0,5,0)
# Existing orders with no entered opening stock must remain operable.
legacy=sqlite3.connect(':memory:', isolation_level=None)
legacy.execute('CREATE TABLE orders(id TEXT PRIMARY KEY,data TEXT NOT NULL)')
legacy.execute('INSERT INTO orders VALUES(?,?)',('old',json.dumps({'status':'shipping','items':[{'name':'Кроссовки','quantity':1}]})))
for statement in sql: legacy.execute(statement)
legacy.execute('INSERT INTO products(id,name_key,data) VALUES(?,?,?)',('p','кроссовки',json.dumps({'name':'Кроссовки'})))
assert legacy.execute('SELECT available,reserved FROM product_stock').fetchone()==(-1,1)
legacy.execute("UPDATE orders SET data=json_set(data,'$.status','redeemed') WHERE id='old'")
assert legacy.execute('SELECT available,reserved,sold FROM product_stock').fetchone()==(-1,0,1)
print('Stock reservations, payment, return, cancellation, edits, retries, shortages and existing orders passed')
