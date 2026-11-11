import {jsPDF} from 'jspdf';
import {autoTable} from 'jspdf-autotable';
import type {WaybillData,CourierCheatsheetData} from './internal-waybill.ts';

const money=(value:number)=>value.toLocaleString('ru-RU',{maximumFractionDigits:2}).replace(/\u00a0/g,' ');

export function waybillPdf(input:WaybillData|WaybillData[],fonts:{regular:string;bold:string}){
 const list=Array.isArray(input)?input:[input];
 if(!list.length)throw Error('Нет накладных для скачивания');
 const doc=waybillDocument(fonts);
 doc.setProperties({title:'Накладные на сборку'});
 for(const [index,data] of list.entries()){
 if(index)doc.addPage();
 const margin={left:10,right:10,top:8,bottom:8};
 autoTable(doc,{
  startY:margin.top,margin,theme:'plain',
  styles:{font:'LiberationSans',fontSize:11,cellPadding:0.6,textColor:0,overflow:'linebreak'},
  body:[
   [{content:`Номер заказа: ${data.id}`,styles:{fontStyle:'bold'}}],
   [`Оператор: ${data.operator}`],
   [`Заказчик: ${data.client}`],
   [`Телефон: ${data.phone}`],
   [`Адрес: ${data.address||'—'}`],
   [`Номер для обратной связи: ${data.callbackPhone}`],
   [`Комментарий заказа: ${data.comment}`],
  ],
 });
 const detailsBottom=(doc as jsPDF & {lastAutoTable:{finalY:number}}).lastAutoTable.finalY;
 autoTable(doc,{
  startY:detailsBottom+5,margin,theme:'grid',
  styles:{font:'LiberationSans',fontSize:11,cellPadding:1.5,textColor:0,lineColor:0,lineWidth:0.25,overflow:'linebreak'},
  headStyles:{fontStyle:'bold',fillColor:255,textColor:0},
  columnStyles:{0:{cellWidth:116},1:{cellWidth:22},2:{cellWidth:26},3:{cellWidth:26}},
  head:[['Название','Кол-во','Цена, руб.','Сумма, руб.']],
  body:[...data.items.map(i=>[i.name,`${i.quantity} шт.`,money(i.price),money(i.quantity*i.price)]),
   [{content:'',colSpan:2,styles:{lineWidth:{top:0.25,right:0,bottom:0,left:0}}},
    {content:'Итого',styles:{fontStyle:'bold',halign:'right'}},
    {content:money(data.items.reduce((s,i)=>s+i.quantity*i.price,0)),styles:{fontStyle:'bold'}}]],
  rowPageBreak:'avoid',
 });
 }
 return doc;
}

async function waybillFonts(){
 const load=async(name:string)=>{
  const response=await fetch(`/fonts/LiberationSans-${name}.ttf`);
  if(!response.ok)throw Error('Не удалось загрузить шрифт для PDF. Повторите скачивание.');
  const bytes=new Uint8Array(await response.arrayBuffer());
  let binary='';
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary);
 };
 const [regular,bold]=await Promise.all([load('Regular'),load('Bold')]);
 return {regular,bold};
}

export async function downloadWaybillPdf(data:WaybillData|WaybillData[]){
 waybillPdf(data,await waybillFonts()).save(Array.isArray(data)?'Накладные на сборку.pdf':`Бланк-${data.id.replace(/[^\p{L}\p{N}_-]/gu,'_')}.pdf`);
}

function waybillDocument(fonts:{regular:string;bold:string}){
 const doc=new jsPDF({format:'a4',unit:'mm'});
 for(const [style,font] of [['normal',fonts.regular],['bold',fonts.bold]]){
  doc.addFileToVFS(`${style}.ttf`,font);
  doc.addFont(`${style}.ttf`,'LiberationSans',style);
 }
 return doc;
}

export function courierCheatsheetPdf(data:CourierCheatsheetData,fonts:{regular:string;bold:string}){
 const doc=waybillDocument(fonts);
 doc.setProperties({title:`Шпаргалка · ${data.id}`});
 autoTable(doc,{startY:10,margin:10,theme:'plain',styles:{font:'LiberationSans',fontSize:12,cellPadding:0.6,textColor:0,overflow:'linebreak'},body:[
  [{content:`Заказ: ${data.id}`,styles:{fontStyle:'bold'}}],
  [`ФИО: ${data.client}`],[`Телефон: ${data.phone}`],[`Адрес: ${data.address||'—'}`],
  [`Комментарий: ${data.comment}`],[`Курьер: ${data.courier}`],[`Сумма заказа: ${money(data.amount)} руб.`],[`Автор заказа: ${data.author}`],
 ]});
 return doc;
}

export async function downloadCourierCheatsheet(data:CourierCheatsheetData){
 courierCheatsheetPdf(data,await waybillFonts()).save(`Шпаргалка-${data.id.replace(/[^\p{L}\p{N}_-]/gu,'_')}.pdf`);
}
