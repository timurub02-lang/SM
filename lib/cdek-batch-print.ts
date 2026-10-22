import JSZip from 'jszip';
import {requestCdekPrint} from './cdek-print-client.ts';
export async function collectCdekWaybills(actorId:string,ids:string[],onProgress:(done:number,total:number)=>void,request=requestCdekPrint){
 const zip=new JSZip(),completed:string[]=[],errors:string[]=[];
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
   zip.file(`СДЭК-${id.replace(/[^a-zA-Z0-9_-]/g,'_')}.pdf`,bytes);completed.push(id);
  }catch(error){errors.push(`${id}: ${error instanceof Error?error.message:'Ошибка скачивания'}`);}
  onProgress(completed.length+errors.length,unique.length);
 }
 if(errors.length)zip.file('Не получены.txt',errors.join('\n'));
 return {bytes:completed.length?await zip.generateAsync({type:'arraybuffer'}):null,completed,errors};
}
