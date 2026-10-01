import assert from 'node:assert/strict';
import {extraCheckLabel} from '../lib/crm.ts';
assert.equal(extraCheckLabel({extra:false,status:'packing'}),'');
for(const status of ['extra','rework'])assert.equal(extraCheckLabel({extra:true,status}),'Нужна доп. проверка');
for(const status of ['packing','phone','shipping','pickup','redeemed','returned'])assert.equal(extraCheckLabel({extra:true,status}),'После доп. проверки');
console.log('Extra check labels passed');
