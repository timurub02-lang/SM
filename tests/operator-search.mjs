import assert from 'node:assert/strict';
import {matchingOperators} from '../lib/operator-search.ts';
const operators=[{id:'1',name:'Соловьёв Никита',login:'SKP_Solovyov.Nikita'},{id:'2',name:'Иванова Ольга',login:'M31_Ivanova.Olga'}];
assert.equal(matchingOperators(operators,'').length,2);
for(const q of ['соло','СОЛОВЬЕВ','skp_s','Никита Солов'])assert.deepEqual(matchingOperators(operators,q).map(o=>o.id),['1']);
assert.equal(matchingOperators(operators,'нет такого').length,0);
console.log('operator search OK');
