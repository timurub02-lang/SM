'use strict';
const {mkdir,open,rename,unlink}=require('node:fs/promises');
const {join}=require('node:path');
const {randomUUID}=require('node:crypto');
function audioSignature(b,extension){return extension==='wav'?b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WAVE':b.toString('ascii',0,3)==='ID3'||b[0]===255&&(b[1]&0xe0)===0xe0;}
async function saveOktellRecording(id,info,dir,download=fetch){
 if(!/^[a-f0-9]{32}$/.test(id)||!info||!['wav','mp3'].includes(info.extension))throw Error('Invalid recording metadata');
 if(info.cached===true){
  const f=await open(join(dir,id+'.'+info.extension),'r');
  try{const {size}=await f.stat(),head=Buffer.alloc(12);await f.read(head,0,12,0);if(size<12||size>32*1024*1024||!audioSignature(head,info.extension))throw Error('Invalid cached recording');}finally{await f.close();}
  return;
 }
 if(typeof info.url!=='string')throw Error('Invalid recording metadata');
 const url=new URL(info.url,'http://10.21.103.2:4055');
 if(url.origin!=='http://10.21.103.2:4055'||url.username||url.password||url.search||url.hash||!/^\/download\/rec\/[A-Za-z0-9_+=@-]{1,2048}$/.test(url.pathname))throw Error('Invalid recording origin');
 if(info.temppass!==undefined){if(typeof info.temppass!=='string'||!/^[-A-Za-z0-9]{1,128}$/.test(info.temppass))throw Error('Invalid recording authorization');url.searchParams.set('temppass',info.temppass);}
 const limit=32*1024*1024;
 const response=await download(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
 if(response.status!==200||!response.body||Number(response.headers.get('content-length'))>limit)throw Error('Recording download unavailable');
 await mkdir(dir,{recursive:true,mode:0o750});
 const target=join(dir,id+'.'+info.extension),temp=target+'.'+randomUUID()+'.tmp';
 const file=await open(temp,'wx',0o640),reader=response.body.getReader();let size=0,signature=Buffer.alloc(0);
 try{
  while(true){
   const {value:chunk,done}=await reader.read();if(done)break;
   size+=chunk.length;if(size>limit)throw Error('Recording too large');
   if(signature.length<12)signature=Buffer.concat([signature,Buffer.from(chunk).subarray(0,12-signature.length)]);
   let written=0;while(written<chunk.length){const r=await file.write(chunk,written,chunk.length-written);if(!r.bytesWritten)throw Error('Recording write failed');written+=r.bytesWritten;}
  }

  const length=response.headers.get('content-length');
  if(size<12||length!==null&&Number(length)!==size||!audioSignature(signature,info.extension))throw Error('Invalid recording audio');
  await file.sync();await file.close();await rename(temp,target);
 }catch(e){await reader.cancel().catch(()=>{});await file.close().catch(()=>{});await unlink(temp).catch(()=>{});throw e;}finally{reader.releaseLock();}
}

module.exports={saveOktellRecording};
