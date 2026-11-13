import assert from 'node:assert/strict';
import {test} from 'node:test';
import {baseStats} from '../lib/base-stats.ts';
test('personal clients and department clients use existing ownership rules',()=>{
 const employees=[{id:'r',role:'operator',department:'M31',login:'rybkina'},{id:'o',role:'operator',department:'M31',login:'other'},{id:'h',role:'department_head',department:'M31',login:'head'},{id:'x',role:'operator',department:'SKP',login:'outside'},{id:'n',role:'department_head',login:'none'}];
 const rows=baseStats(employees,[{owner:'r',total:44},{owner:'o',total:314},{owner:'x',total:9},{owner:'unknown',total:100}]);
 assert.equal(rows.find(r=>r.id==='r').clients,44);
 assert.equal(rows.find(r=>r.id==='h').clients,358);
 assert.equal(rows.find(r=>r.id==='n').clients,0);
});
