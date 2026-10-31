export class BodyTooLarge extends Error {}
// Stop reading at the limit, including chunked requests without Content-Length.
export async function readLimitedText(request:Request,maxBytes:number){
 const length=Number(request.headers.get('content-length'));
 if(Number.isFinite(length)&&length>maxBytes)throw new BodyTooLarge('Слишком большой запрос');
 if(!request.body)return '';
 const reader=request.body.getReader(),decoder=new TextDecoder();let bytes=0,text='';
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes){await reader.cancel();throw new BodyTooLarge('Слишком большой запрос');}text+=decoder.decode(value,{stream:true});}
  return text+decoder.decode();
 }finally{reader.releaseLock();}
}
