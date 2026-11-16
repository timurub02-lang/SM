import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../server/sqlite.ts';
import {readProductCosts,productCostsGuard,productCostSchema} from '../lib/warehouse-cost.ts';
const dir=mkdtempSync(join(tmpdir(),'warehouse-cost-')),d=openDatabase(join(dir,'test.sqlite'));
try{
 await d.prepare('CREATE TABLE products(id TEXT PRIMARY KEY,data TEXT)').run();
 await d.prepare('CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT)').run();
 await d.prepare('INSERT INTO products VALUES(?,?)').bind('one',JSON.stringify({name:' Product '})).run();
 const empty=await readProductCosts(d);assert.equal(empty.prices.product,null);
 await d.prepare('INSERT INTO settings VALUES(?,?)').bind('warehouse-cost:one',JSON.stringify({amount:300,revision:'one'})).run();
 const costs=await readProductCosts(d);assert.equal(costs.prices.product,300);
 assert.equal(await d.prepare('SELECT 1 AS ok WHERE '+productCostsGuard).bind(empty.revision).first(),null,'A price change invalidates payment/closing guards');
 assert.equal((await d.prepare('SELECT 1 AS ok WHERE '+productCostsGuard).bind(costs.revision).first()).ok,1);
 await d.prepare('UPDATE products SET data=?').bind(JSON.stringify({name:'Renamed'})).run();
 assert.equal(await d.prepare('SELECT 1 AS ok WHERE '+productCostsGuard).bind(costs.revision).first(),null,'A rename also invalidates the calculation');
 assert.throws(()=>productCostSchema.parse({amount:1.001,revision:''}));
 assert.equal(productCostSchema.parse({amount:0,revision:''}).amount,0);
 console.log('Warehouse cost lookup, precision and payment/closing revision guards passed');
}finally{d.close();rmSync(dir,{recursive:true,force:true});}
