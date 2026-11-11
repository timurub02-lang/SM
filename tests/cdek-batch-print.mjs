import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {PDFDocument} from 'pdf-lib';
import {collectCdekWaybills} from '../lib/cdek-batch-print.ts';
async function fixture(label,sizes){
 const pdf=await PDFDocument.create();
 for(const [index,size] of sizes.entries()){
  const page=pdf.addPage(size);
  page.drawText(`${label} - page ${index+1}`,{x:40,y:size[1]-60,size:18});
  for(let i=0;i<50;i++)if(i%3!==0)page.drawRectangle({x:40+i*3,y:size[1]-125,width:2,height:40});
 }
 return new Uint8Array(await pdf.save({addDefaultPage:false})).buffer;
}
const documents={one:await fixture('Order ONE',[[595,842]]),two:await fixture('Order TWO',[[420,595],[595,842]]),empty:await fixture('Empty',[])};
const calls=[],progress=[];
const result=await collectCdekWaybills('actor',['one','pending','two','one','broken','corrupt','empty','denied'],(done,total)=>progress.push([done,total]),async body=>{
 calls.push(body);
 if(body.orderId==='pending')return Response.json({message:'Ещё готовится'},{status:202});
 if(body.orderId==='denied')return Response.json({error:'Нет доступа'},{status:403});
 const bytes=documents[body.orderId]||(body.orderId==='corrupt'?'%PDF-corrupt':'invalid');
 return new Response(bytes,{headers:{'Content-Type':'application/pdf'}});
});
assert.deepEqual(result.completed,['one','two']);assert.equal(result.errors.length,5);
assert.deepEqual(calls.map(x=>x.orderId),['one','pending','two','broken','corrupt','empty','denied']);
assert.ok(calls.every(x=>x.actorId==='actor'));
assert.deepEqual(progress.at(-1),[7,7]);
assert.equal(new TextDecoder().decode(result.bytes.slice(0,5)),'%PDF-');
const pdf=await PDFDocument.load(result.bytes);
assert.equal(pdf.getPageCount(),3);
assert.deepEqual(pdf.getPages().map(p=>[p.getWidth(),p.getHeight()]),[[595,842],[420,595],[595,842]]);
assert(result.errors.some(error=>error.includes('pending: Ещё готовится')));
assert(result.errors.some(error=>error.includes('denied: Нет доступа')));
assert.equal((await collectCdekWaybills('actor',['fail'],()=>{},async()=>{throw Error('Network');})).bytes,null);
assert.equal((await collectCdekWaybills('actor',[],()=>{})).bytes,null);
mkdirSync('work/batch-pdf',{recursive:true});
writeFileSync('work/batch-pdf/combined.pdf',Buffer.from(result.bytes));
console.log('CDEK batch PDF: exact selection, page order/size, multipage orders, duplicates, corrupt/empty PDFs, partial errors, access and empty result passed');
