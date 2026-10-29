import ExcelJS from 'exceljs';
import {departments,type Employee} from './crm';
import {payrollVisible,type PayrollRow,type PayrollOrder,type PayrollPeriod} from './premium-ledger';

export async function premiumWorkbook(actor:Employee,period:string,label:string,entry:PayrollPeriod,allRows:PayrollRow[],allOrders:PayrollOrder[]){
 if(!['admin','department_head'].includes(actor.role))throw Error('Выгрузка недоступна');
 const rows=allRows.filter(r=>payrollVisible(actor,r)),orders=allOrders.filter(r=>payrollVisible(actor,r));
 const groups=[...new Set([...rows.map(r=>r.department),...orders.map(r=>r.department)])].sort();
 const book=new ExcelJS.Workbook();book.creator='СМ CRM';
 const status=entry.status==='paid'?'Выплачено':entry.status==='frozen'?'Зафиксировано':'Предварительный расчёт';
 function sheet(name:string,headers:string[],widths:number[]){
  const s=book.addWorksheet(name,{views:[{state:'frozen',ySplit:4}]});
  s.addRow(['Премия · '+label]);s.mergeCells(1,1,1,headers.length);s.getRow(1).font={size:16,bold:true,color:{argb:'FF17365D'}};s.getRow(1).height=28;
  s.addRow([status+' · Суммы заказов без удержаний СДЭК'+(rows.some(r=>r.payout===null)?' · Итоги неполные: есть нерассчитанные выплаты':'')]);s.mergeCells(2,1,2,headers.length);s.getRow(2).height=23;
  s.addRow([]);s.addRow(headers);s.columns.forEach((c,i)=>{c.width=widths[i]||18;});
  s.getRow(4).height=34;s.getRow(4).eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17365D'}};c.alignment={vertical:'middle',wrapText:true};});
  s.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:4'};
  return s;
 }
 const sum=(list:PayrollRow[],sz:boolean)=>Math.round(list.filter(r=>r.input.sz===sz).reduce((n,r)=>n+Math.round((r.payout||0)*100),0))/100;
 const summary=sheet('Итоги',['Отдел','Заказов','Сумма заказов, ₽','Выплата Н, ₽','Выплата СЗ, ₽','Всего к выплате, ₽','Подпись руководителя'],[20,12,23,23,23,23,34]);
 for(const group of groups){
  const staff=rows.filter(r=>r.department===group),list=orders.filter(o=>o.department===group),name=departments[group as keyof typeof departments]||group||'Без отдела';
  const signer=entry.signers?.find(h=>h.department===group),signature=signer&&entry.signatures[signer.id];
  summary.addRow([name,list.length,list.reduce((n,o)=>n+Math.round(o.amount*100),0)/100,sum(staff,false),sum(staff,true),sum(staff,false)+sum(staff,true),signature?'Подписано '+signature.at:entry.status==='open'?'Расчёт открыт':'Ожидается подпись']);
  const title=name.replace(/[\\/*?:\[\]]/g,'').slice(0,20)||'Отдел';
  const payroll=sheet(title+'_выплаты',['Логин','ФИО','Роль','Заказы, ₽','Ставка, %','Итог %, ₽','Окладная часть, ₽','Отпускные, ₽','Официальная часть, ₽','Долг / аванс, ₽','Штраф, ₽','Доп. премия, ₽','Расчётный итог, ₽','Выплата Н, ₽','Выплата СЗ, ₽'],[36,38,19,20,14,20,20,18,20,20,18,20,22,22,22]);
  for(const r of staff)payroll.addRow([r.login,r.name,r.role==='department_head'?'Руководитель':'Оператор',r.role==='operator'?r.volume:null,r.role==='operator'?r.rate:null,r.commission,r.salary,r.input.vacation,r.input.official,r.input.debt,r.input.penalty,r.input.extra,r.result??'Не рассчитано',r.input.sz?null:r.payout??'Не рассчитано',r.input.sz?r.payout??'Не рассчитано':null]);
  payroll.addRow(['ИТОГО','','',staff.filter(r=>r.role==='operator').reduce((n,r)=>n+Math.round(r.volume*100),0)/100,...Array(9).fill(null),sum(staff,false),sum(staff,true)]).font={bold:true};
  const detail=sheet(title+'_заказы',['Номер заказа','Номер в CRM','Оператор','Сумма заказа без удержаний, ₽'],[24,28,40,32]);
  for(const o of list)detail.addRow([o.externalId,o.id||'Не сопоставлен',o.login,o.amount]);
  detail.addRow(['ИТОГО',list.length,'',list.reduce((n,o)=>n+Math.round(o.amount*100),0)/100]).font={bold:true};
 }
 summary.addRow(['ИТОГО',orders.length,orders.reduce((n,o)=>n+Math.round(o.amount*100),0)/100,sum(rows,false),sum(rows,true),sum(rows,false)+sum(rows,true),'']).font={bold:true};
 for(const s of book.worksheets){s.autoFilter={from:{row:4,column:1},to:{row:Math.max(4,s.rowCount-1),column:s.columnCount}};s.eachRow((r,i)=>{if(i<5)return;r.height=30;r.eachCell(c=>{c.alignment={vertical:'middle',wrapText:true};if(typeof c.value==='number')c.numFmt='#,##0.00;[Red](#,##0.00);"—"';});});}
 return book;
}
