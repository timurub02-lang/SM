import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {baseSettingsSchema,initialBaseSettings} from '@/lib/base-policy';
import {clientSheet,type Client} from '@/lib/crm';
import ExcelJS from 'exceljs';
export const GET=authenticated(async req=>{
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});const url=new URL(req.url),actor=await db().prepare('SELECT data FROM employees WHERE id=?').bind(url.searchParams.get('actorId')||'').first<{data:string}>();if(!actor||JSON.parse(actor.data).role!=='admin')return Response.json({error:'Доступно администратору'},{status:403});
 const base=url.searchParams.get('base');if(base!=='M'&&base!=='J')return Response.json({error:'Выберите М или Ж'},{status:400});
 const saved=await db().prepare("SELECT data FROM settings WHERE id='base-settings'").first<{data:string}>(),config=baseSettingsSchema.parse(saved?JSON.parse(saved.data).config:initialBaseSettings())[base];
 const rows=(await db().prepare("SELECT data FROM clients WHERE COALESCE(json_extract(data,'$.baseType'),'M')=? ORDER BY id").bind(base).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as Client);
 const employees=(await db().prepare('SELECT data FROM employees').all<{data:string}>()).results.map(r=>JSON.parse(r.data));const logins=new Map(employees.map(e=>[e.id,e.login]));
 const orders=(await db().prepare('SELECT id,client_id FROM orders').all<{id:string;client_id:string}>()).results,byClient=new Map<string,string[]>();for(const o of orders)byClient.set(o.client_id,[...byClient.get(o.client_id)||[],o.id]);
 const book=new ExcelJS.Workbook();
 for(const name of [...new Set([...config.sheets.map(s=>s.name),...rows.map(c=>clientSheet(c)||config.importSheet)])]){
 const sheet=book.addWorksheet(name),clients=rows.filter(c=>(clientSheet(c)||config.importSheet)===name),extra=[...new Set(clients.flatMap(c=>Object.keys(c.importFields||{})))].filter(k=>!['ID','ФИО','Телефон','Дата','Оператор','Заказы','Закреплён до'].includes(k));
 sheet.addRow(['ID','ФИО','Телефон','Дата','Оператор','Заказы','Закреплён до',...extra]);
 for(const c of clients)sheet.addRow([c.id,c.name,c.phone,c.distributedAt||'',logins.get(c.owner)||'',(byClient.get(c.id)||[]).join(', '),c.assignedUntil||'',...extra.map(k=>c.importFields?.[k]||'')]);
 sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];sheet.columns.forEach(c=>c.width=24);sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:7+extra.length}};
 }
 const links=book.addWorksheet('Связанные номера');links.addRow(['Основной телефон','Дополнительный телефон']);for(const c of rows)for(const phone of c.linkedPhones||[])links.addRow([c.phone,phone]);links.columns.forEach(c=>c.width=24);
 const content=await book.xlsx.writeBuffer();return new Response(new Uint8Array(content),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="base-${base}.xlsx"`,'Cache-Control':'no-store'}});
});
