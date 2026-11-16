import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {readImportWorkbook} from '../lib/base-import-workbook.ts';
const book=new ExcelJS.Workbook();
const visible=book.addWorksheet('Clients');visible.addRows([['ФИО','Телефон','город','доп номер','сумма'],['Иванов Иван Иванович','79990000001','Тула','','10000']]);
for(const state of ['hidden','veryHidden']){
 const sheet=book.addWorksheet(state,{state});sheet.addRows([['Неверный заголовок'],['Игнорировать']]);
}
const links=book.addWorksheet('Связанные номера',{state:'hidden'});links.addRows([['Основной','Дополнительный'],['79990000001','79990000002']]);
const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await book.xlsx.writeBuffer());
let parsed=readImportWorkbook(loaded);assert.equal(parsed.output.length,1);assert.deepEqual(parsed.output[0].linkedPhones,[]);
assert.equal(parsed.output[0].city,'Тула');assert.equal(parsed.output[0].fields,undefined);
loaded.getWorksheet('Clients').getCell('D2').value='8 (999) 000-00-03; 79990000004';
assert.deepEqual(readImportWorkbook(loaded).output[0].linkedPhones,['79990000003','79990000004']);
loaded.getWorksheet('Clients').getCell('D2').value='сломанный номер';assert.throws(()=>readImportWorkbook(loaded),/дополнительный телефон/);
loaded.getWorksheet('Clients').getCell('D2').value='';
loaded.getWorksheet('Связанные номера').state='visible';parsed=readImportWorkbook(loaded);assert.ok(parsed.output[0].linkedPhones.includes('79990000002'));
loaded.getWorksheet('Clients').state='hidden';assert.equal(readImportWorkbook(loaded).output.length,0);
console.log('Hidden and veryHidden sheets, including phone links, are excluded after XLSX round trip');
