import {PDFDocument} from 'pdf-lib';
import {requestCdekPrint} from './cdek-print-client.ts';
export async function collectCdekWaybills(actorId:string,ids:string[],onProgress:(done:number,total:number)=>void,request=requestCdekPrint){
 const pdf=await PDFDocument.create(),completed:string[]=[],errors:string[]=[];
 pdf.setTitle('Накладные СДЭК');
 const unique=[...new Set(ids)];
 for(const id of unique){
  try{
   const response=await request({actorId,orderId:id});
   if(!response.ok||!response.headers.get('content-type')?.includes('application/pdf')){
    const data=await response.json() as {error?:string;message?:string};
    throw Error(data.error||data.message||'Накладная пока недоступна');
   }
   const bytes=await response.arrayBuffer();
   if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Получен некорректный PDF');
   const source=await PDFDocument.load(bytes);
   if(!source.getPageCount())throw Error('В PDF накладной нет страниц');
   const pages=await pdf.copyPages(source,source.getPageIndices());
   for(const page of pages)pdf.addPage(page);
   completed.push(id);
  }catch(error){errors.push(`${id}: ${error instanceof Error?error.message:'Ошибка скачивания'}`);}
  onProgress(completed.length+errors.length,unique.length);
 }
 return {bytes:completed.length?new Uint8Array(await pdf.save()).buffer:null,completed,errors};
}
