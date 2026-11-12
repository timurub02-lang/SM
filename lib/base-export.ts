import {baseSettingsSchema,initialBaseSettings} from './base-policy';
import {clientSheet,type Client} from './crm';
import ExcelJS from 'exceljs';
import type {db} from './db';
export async function baseWorkbook(d:ReturnType<typeof db>,base:'M'|'J',filename?:string){
 const saved=await d.prepare("SELECT data FROM settings WHERE id='base-settings'").first<{data:string}>(),config=baseSettingsSchema.parse(saved?JSON.parse(saved.data).config:initialBaseSettings())[base];
 const rows=(await d.prepare("SELECT data FROM clients WHERE COALESCE(json_extract(data,'$.baseType'),'M')=? ORDER BY id").bind(base).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as Client);
 const employees=(await d.prepare('SELECT data FROM employees').all<{data:string}>()).results.map(r=>JSON.parse(r.data));const logins=new Map(employees.map(e=>[e.id,e.login]));
 const orders=(await d.prepare('SELECT id,client_id FROM orders').all<{id:string;client_id:string}>()).results,byClient=new Map<string,string[]>();for(const o of orders)byClient.set(o.client_id,[...byClient.get(o.client_id)||[],o.id]);
 const book=filename?new ExcelJS.stream.xlsx.WorkbookWriter({filename,useStyles:true,useSharedStrings:true}):new ExcelJS.Workbook();
 for(const name of [...new Set([...config.sheets.map(s=>s.name),...rows.map(c=>clientSheet(c)||config.importSheet)])]){
 const sheet=book.addWorksheet(name,{views:[{state:'frozen',ySplit:1}]}),clients=rows.filter(c=>(clientSheet(c)||config.importSheet)===name),extra=[...new Set(clients.flatMap(c=>Object.keys(c.importFields||{})))].filter(k=>!['ID','ФИО','Телефон','Дата','Оператор','Заказы','Закреплён до'].includes(k));
 sheet.addRow(['ID','ФИО','Телефон','Дата','Оператор','Заказы','Закреплён до',...extra]);
 sheet.getRow(1).font={bold:true};sheet.columns.forEach(c=>c.width=24);if(filename)sheet.getRow(1).commit();
 for(const c of clients){const row=sheet.addRow([c.id,c.name,c.phone,c.distributedAt||'',logins.get(c.owner)||'',(byClient.get(c.id)||[]).join(', '),c.assignedUntil||'',...extra.map(k=>c.importFields?.[k]||'')]);if(filename)row.commit();}
 sheet.autoFilter={from:{row:1,column:1},to:{row:clients.length+1,column:7+extra.length}};if(filename)sheet.commit();
 }
 const links=book.addWorksheet('Связанные номера');links.addRow(['Основной телефон','Дополнительный телефон']);links.columns.forEach(c=>c.width=24);if(filename)links.getRow(1).commit();for(const c of rows)for(const phone of c.linkedPhones||[]){const row=links.addRow([c.phone,phone]);if(filename)row.commit();}

 if(filename){links.commit();await (book as ExcelJS.stream.xlsx.WorkbookWriter).commit();}
 return book;
}
