import assert from 'node:assert/strict';
import {planImport} from '../lib/base-import.ts';
import {appendImportPreview,emptyImportReport} from '../lib/base-import-preview.ts';
const row=(n,name='Иванов Иван Иванович',linkedPhones=[])=>({row:n,phone:String(79000000000+n),name,linkedPhones});
const existing=[{id:'old',phone:row(1).phone,linkedPhones:[row(2).phone],version:1}];
const rows=Array.from({length:2129},(_,i)=>row(i+1));
rows[1000]=row(2); // Same existing client across batches.
rows[1001]=row(3,'Иванов Иван Иванович',[row(5000).phone]);
rows[1002]=row(5000); // Earlier duplicate must not reserve its extra phone.
rows[1500]=row(6000,'Саша');rows[1501]={...row(6000,'Саша'),row:1502};rows[2000]=row(6000,'Саша');
rows[2100]={...row(7000),phone:'bad'};rows[2101]=row(7001,'Иванова Анна Ивановна');
const targets={M:'Т1',J:'Ж1'};
function report(plan){return {...emptyImportReport(),previewRows:plan.previewRows,added:plan.added.length,skipped:plan.skipped,duplicates:plan.duplicates,review:plan.review,invalid:plan.invalid,addedByBase:{M:plan.added.filter(r=>r.destination==='M').length,J:plan.added.filter(r=>r.destination==='J').length}};}
const expected=report(planImport(rows,existing,'M','Т1',{},targets));delete expected.previewRows;
let total=emptyImportReport(),seen=new Set();
for(let offset=0;offset<rows.length;offset+=1000)total=appendImportPreview(total,report(planImport(rows.slice(offset,offset+1000),existing,'M','Т1',{},targets,false)),seen);
assert.deepEqual(total,expected);
assert.equal(total.added+total.skipped+total.duplicates+total.invalid.length+total.review.length,2129);
assert.equal(total.review.length,1);assert.equal(total.addedByBase.J,1);
console.log('Whole-file preview matches one plan: 2129 rows, cross-batch linked duplicates, existing clients, unknown names and invalid phones');
