import assert from 'node:assert/strict';
import {test} from 'node:test';
import {averageBaseClients,baseStats,filterBaseStats} from '../lib/base-stats.ts';
test('personal clients and department clients use existing ownership rules',()=>{
 const employees=[{id:'r',role:'operator',department:'M31',login:'rybkina'},{id:'o',role:'operator',department:'M31',login:'other'},{id:'h',role:'department_head',department:'M31',login:'head'},{id:'x',role:'operator',department:'SKP',login:'outside'},{id:'n',role:'department_head',login:'none'}];
 const rows=baseStats(employees,[{owner:'r',total:44},{owner:'o',total:314},{owner:'x',total:9},{owner:'unknown',total:100}]);
 assert.equal(rows.find(r=>r.id==='r').clients,44);
 assert.equal(rows.find(r=>r.id==='h').clients,358);
 assert.equal(rows.find(r=>r.id==='n').clients,0);
 const selected=filterBaseStats(rows,'M31');
 assert.deepEqual(selected.rows.map(r=>r.id),['o','r','h']);
 assert.equal(selected.total,358);
 assert.equal(selected.leader.id,'o');
 assert.equal(selected.leader.clients,314);
 assert.equal(filterBaseStats(rows,'').leader.id,'o');
 assert.equal(filterBaseStats(rows,'missing').leader,undefined);
 assert.equal(filterBaseStats(rows,'SKP').total,9);
 assert.equal(filterBaseStats(rows,'missing').total,0);
 assert.deepEqual(filterBaseStats(rows,'').rows.map(r=>r.id),['o','r','h','x','n']);
 assert.equal(filterBaseStats(rows,'').total,367);
 assert.equal(filterBaseStats(rows,'').rows.length,rows.length);
});

test('department average excludes newcomers at ten and below and excludes leaders',()=>{
 const rows=[{id:'a',role:'operator',department:'3',clients:44},{id:'b',role:'operator',department:'3',clients:11},{id:'c',role:'operator',department:'3',clients:10},{id:'d',role:'operator',department:'3',clients:0},{id:'h',role:'department_head',department:'3',clients:65},{id:'x',role:'operator',department:'1',clients:90}];
 assert.equal(averageBaseClients(rows,'3'),27.5);
 assert.equal(averageBaseClients(rows,'1'),90);
 assert.equal(averageBaseClients(rows,'4'),null);
 assert.equal(averageBaseClients([{role:'operator',department:'5',clients:10}],'5'),null);
});
