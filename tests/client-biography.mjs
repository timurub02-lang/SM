import assert from 'node:assert/strict';
import {clientSchema} from '../lib/crm.ts';
const c={name:'Клиент',phone:'+79991234567',biography:'  Предпочитает звонки вечером  '};
assert.equal(clientSchema.parse(c).biography,'Предпочитает звонки вечером');
assert.equal(clientSchema.parse({...c,biography:''}).biography,'');
assert.throws(()=>clientSchema.parse({...c,biography:'x'.repeat(5001)}));
console.log('Client biography validation passed');
