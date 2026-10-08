import {jsPDF} from 'jspdf';
import {postalMoneyPlaceholders,postalSenderSchema,type PostalFormData} from './postal-form.ts';

export function postalFormPdf(data:PostalFormData,assets:{font:string;template:Uint8Array}){
 const sender=postalSenderSchema.parse(data.sender),recipient=postalSenderSchema.parse(data.recipient);
 const doc=new jsPDF({format:'a4',unit:'pt'});
 doc.addFileToVFS('postal.ttf',assets.font);
 doc.addFont('postal.ttf','LiberationSans','normal');
 doc.setFont('LiberationSans');
 doc.setProperties({title:`Почтовый бланк ${data.id}`});
 // Original blank artwork extracted from the supplied form; coordinates retain its print size.
 doc.addImage(assets.template,'JPEG',87.87,70.86,419.53,297.64);
 const fit=(value:string,x:number,y:number,width:number,lines:number,size=9,lineStep?:number)=>{
  for(let fontSize=size;fontSize>=7;fontSize-=0.5){
   doc.setFontSize(fontSize);
   const wrapped=doc.splitTextToSize(value.replace(/\s+/g,' ').trim(),width) as string[];
   if(wrapped.length<=lines&&wrapped.every(line=>doc.getTextWidth(line)<=width+0.1)){
    doc.text(wrapped,x,y,{lineHeightFactor:lineStep?lineStep/fontSize:1.15});return;
   }
  }
  throw Error('ФИО или адрес слишком длинные для почтового бланка. Сократите их без потери важных данных и скачайте бланк снова.');
 };
 doc.setFontSize(13);doc.text('x',240.38,86.96); // Посылка
 doc.setFontSize(8.5);doc.text('x',337.32,91.84); // Наложенный платёж, как в образце
 fit(sender.name,128,170.5,164,2,8.5);
 fit(sender.address,90.71,204,198,4,9,12.5);
 fit(sender.phone,90.71,262,132,1,8);
 fit(recipient.name,328,235,174,2,8.5);
 fit(recipient.address,303.31,270,198,4,9,12.5);
 fit(recipient.phone,303.31,328.95,132,1,8);
 for(const [party,x,y] of [[sender,233.35,263.5],[recipient,442.25,329.53]] as const){
  doc.setFontSize(9);
  [...party.postalCode].forEach((digit,i)=>doc.text(digit,x+i*10.77,y));
 }
 doc.setFontSize(9);
 doc.text(postalMoneyPlaceholders.declaredValue,350,168.23);
 doc.text(postalMoneyPlaceholders.cashOnDelivery,350,196.57);
 doc.setFontSize(8);
 doc.text(`Заказ ${data.id} · Суммы уточняются`,87.87,387);
 return doc;
}

export async function downloadPostalFormPdf(data:PostalFormData){
 const [fontResponse,templateResponse]=await Promise.all([fetch('/fonts/LiberationSans-Regular.ttf'),fetch('/forms/russian-post-f7p.jpg')]);
 if(!fontResponse.ok||!templateResponse.ok)throw Error('Не удалось загрузить почтовый бланк. Повторите скачивание.');
 const [fontBytes,template]=await Promise.all([fontResponse.arrayBuffer(),templateResponse.arrayBuffer()]);
 let binary='';for(const byte of new Uint8Array(fontBytes))binary+=String.fromCharCode(byte);
 postalFormPdf(data,{font:btoa(binary),template:new Uint8Array(template)}).save(`Почтовый-бланк-${data.id.replace(/[^\p{L}\p{N}_-]/gu,'_')}.pdf`);
}
