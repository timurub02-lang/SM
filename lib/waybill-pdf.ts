import {jsPDF} from 'jspdf';
import {autoTable} from 'jspdf-autotable';
import type {WaybillData} from './internal-waybill.ts';

const money=(value:number)=>value.toLocaleString('ru-RU',{maximumFractionDigits:2}).replace(/\u00a0/g,' ');

export function waybillPdf(input:WaybillData|WaybillData[],fonts:{regular:string;bold:string}){
 const list=Array.isArray(input)?input:[input];
 if(!list.length)throw Error('Нет накладных для скачивания');
 const doc=new jsPDF({format:'a4',unit:'mm'});
 for(const [style,font] of [['normal',fonts.regular],['bold',fonts.bold]]){
  doc.addFileToVFS(`${style}.ttf`,font);
  doc.addFont(`${style}.ttf`,'LiberationSans',style);
 }
 doc.setProperties({title:'Накладные на сборку'});
 const half=doc.internal.pageSize.getHeight()/2;
 for(const [index,data] of list.entries()){
 if(index)doc.addPage();
 const firstPage=doc.getNumberOfPages();
 // Each copy has its own half-page margins, including continuation pages.
 for(const offset of [0,half]){
 doc.setPage(firstPage);
 const margin={left:10,right:10,top:offset+8,bottom:half-offset+8};
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
 }
 for(let page=1;page<=doc.getNumberOfPages();page++){
  doc.setPage(page);
  doc.setDrawColor(150);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([2,2],0);
  doc.line(10,half,200,half);
 }
 return doc;
}

export async function downloadWaybillPdf(data:WaybillData|WaybillData[]){
 const load=async(name:string)=>{
  const response=await fetch(`/fonts/LiberationSans-${name}.ttf`);
  if(!response.ok)throw Error('Не удалось загрузить шрифт для PDF. Повторите скачивание.');
  const bytes=new Uint8Array(await response.arrayBuffer());
  let binary='';
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary);
 };
 const [regular,bold]=await Promise.all([load('Regular'),load('Bold')]);
 waybillPdf(data,{regular,bold}).save(Array.isArray(data)?'Накладные на сборку.pdf':`Бланк-${data.id.replace(/[^\p{L}\p{N}_-]/gu,'_')}.pdf`);
}
