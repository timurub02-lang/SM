import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import ExcelJS from 'exceljs';
import {newProjectSettings} from '../lib/oktell-project-settings.ts';
import {saveProjectDraft} from '../lib/oktell-project-store.ts';
import {importProjectWorkbook,parseProjectWorkbook,projectImportInventory,validateWorkbookZip} from '../lib/oktell-project-import.ts';

const sql=new DatabaseSync(':memory:');let fail=false;
const wrap=(query,args=[])=>({bind:(...a)=>wrap(query,a),first:async()=>sql.prepare(query).get(...args),all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>{if(fail&&query.startsWith('INSERT INTO oktell_project_contacts'))throw Error('Synthetic database failure');return {meta:sql.prepare(query).run(...args)};}});
const db={prepare:q=>wrap(q),batch:async statements=>{sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const projectId=randomUUID(),other=randomUUID(),options={projectId,name:0,city:0};
async function workbook(rows,headers=['Телефон','Имя','Город']){const b=new ExcelJS.Workbook(),s=b.addWorksheet('Контакты');s.addRow(headers);rows.forEach(r=>s.addRow(r));return Buffer.from(await b.xlsx.writeBuffer());}
try{
 for(const id of [projectId,other])await saveProjectDraft(db,'admin',{id,action:'create',settings:newProjectSettings()});
 const file=await workbook([
  ['8 (999) 000-00-01','Тестовый контакт','Москва'],
  [79990000001,'Дубль с другим именем',''],
  ['9990000002','Второй','Казань'],
  ['ошибка','Неверный номер',''],
  [{formula:'70000000000+1',result:70000000001},'Формула',''],
  ['', 'Без телефона',''],
  ['','',''],
 ]);
 const initial=await importProjectWorkbook(db,'admin',file,options,'тест.xlsx');
 assert.equal(initial.applied,false);assert.equal(initial.preview.added,2);assert.equal(initial.preview.duplicates,1);assert.equal(initial.preview.invalid,3);
 assert.equal((await projectImportInventory(db,projectId)).total,0);
 const done=await importProjectWorkbook(db,'admin',file,initial.preview.options,'тест.xlsx',initial.preview.token);
 assert.equal(done.applied,true);assert.equal(done.receipt.added,2);
 const replay=await importProjectWorkbook(db,'admin',file,initial.preview.options,'переименованный.xlsx',initial.preview.token);assert.equal(replay.replayed,true);
 assert.equal((await projectImportInventory(db,projectId)).total,2);
 assert.equal((await projectImportInventory(db,other)).total,0);
 const another=await importProjectWorkbook(db,'admin',file,{...options,projectId:other},'тест.xlsx');assert.equal(another.preview.added,2);
 const next=await workbook([['79990000001','НЕ ПЕРЕЗАПИСЫВАТЬ',''],['79990000003','Третий','']]);
 const stale=await importProjectWorkbook(db,'admin',next,options,'второй.xlsx');assert.equal(stale.preview.duplicates,1);
 const concurrent=await workbook([['79990000004','Четвёртый','']]);
 const concurrentPreview=await importProjectWorkbook(db,'admin',concurrent,options,'третий.xlsx');
 await importProjectWorkbook(db,'admin',concurrent,options,'третий.xlsx',concurrentPreview.preview.token);
 await assert.rejects(importProjectWorkbook(db,'admin',next,options,'второй.xlsx',stale.preview.token),e=>e.status===409);
 const refreshed=await importProjectWorkbook(db,'admin',next,options,'второй.xlsx');
 fail=true;await assert.rejects(importProjectWorkbook(db,'admin',next,options,'второй.xlsx',refreshed.preview.token),/Synthetic/);fail=false;
 assert.equal((await projectImportInventory(db,projectId)).total,3);
 await importProjectWorkbook(db,'admin',next,options,'второй.xlsx',refreshed.preview.token);
 const inventory=await projectImportInventory(db,projectId);assert.equal(inventory.total,4);assert.equal(inventory.imports.length,3);assert.equal(inventory.contacts.find(c=>c.phone==='79990000001').name,'Тестовый контакт');
 const custom=await workbook([['Клиент',79990000005,'Город']],['Фамилия','Связь','Регион']);
 assert.equal((await parseProjectWorkbook(custom,options)).options.phone,0);
 const mapped=await parseProjectWorkbook(custom,{...options,phone:2,name:1,city:3});assert.equal(mapped.contacts[0].phone,'79990000005');
 await assert.rejects(parseProjectWorkbook(custom,{...options,phone:2,name:2}),/разные/);
 await assert.rejects(parseProjectWorkbook(file,{...options,sheet:20}),/не найден/);
 const hiddenBook=new ExcelJS.Workbook();hiddenBook.addWorksheet('Скрытый',{state:'hidden'}).addRows([['Телефон'],['79990000006']]);hiddenBook.addWorksheet('Видимый').addRows([['Телефон'],['79990000007']]);
 assert.equal((await parseProjectWorkbook(Buffer.from(await hiddenBook.xlsx.writeBuffer()),options)).contacts[0].phone,'79990000007');
 await assert.rejects(importProjectWorkbook(db,'admin',file,{...options,projectId:randomUUID()},'тест.xlsx'),e=>e.status===404);
 await assert.rejects(importProjectWorkbook(db,'admin',file,options,'старый.xls'),/xlsx/);
 assert.throws(()=>validateWorkbookZip(Buffer.from('broken')),/повреждён/);
 assert.throws(()=>validateWorkbookZip(Buffer.alloc(5*1024*1024+1)),e=>e.status===413);
 const forged=Buffer.from(file),central=forged.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));forged.writeUInt32LE(40*1024*1024,central+24);assert.throws(()=>validateWorkbookZip(forged),/повреждён/);
 const sparse=new ExcelJS.Workbook();sparse.addWorksheet('Контакты').getCell('A50002').value='79990000008';
 await assert.rejects(parseProjectWorkbook(Buffer.from(await sparse.xlsx.writeBuffer()),options),/повреждён/);
 const bulk=await workbook(Array.from({length:30000},(_,i)=>[String(79900000000+i),'Синтетический '+i,'']));
 assert.equal((await parseProjectWorkbook(bulk,options)).contacts.length,30000);
 console.log('PASS: XLSX parsing, mappings, numeric phones, formulas/errors, duplicates, project isolation, receipt retries, concurrent preview CAS, atomic rollback and archive limits');
}finally{sql.close();}
