export async function downloadExport(kind:'base'|'premium',parameter:string,legacyUrl:string,filename:string,progress:(text:string)=>void){
 const response=await fetch('/api/exports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,parameter,requestKey:crypto.randomUUID()})}),data=await response.json() as {id:string;backgroundDisabled?:boolean;error?:string};
 let url=legacyUrl;
 if(response.status!==409||!data.backgroundDisabled){
  if(!response.ok)throw Error(data.error||'Не удалось создать выгрузку');
  const deadline=Date.now()+10*60*1000;let ready=false;
  while(Date.now()<deadline){
   const check=await fetch('/api/exports?id='+encodeURIComponent(data.id)),job=await check.json() as {state:string;error?:string};
   if(!check.ok||job.state==='failed')throw Error(job.error||'Не удалось подготовить выгрузку');
   if(job.state==='ready'){ready=true;break;}
   progress(job.state==='running'?'Готовим Excel…':'Excel в очереди…');await new Promise(resolve=>setTimeout(resolve,1500));
  }
  if(!ready)throw Error('Выгрузка занимает больше времени. Повторите позже.');
  url='/api/exports?id='+encodeURIComponent(data.id)+'&download=1';
 }
 const file=await fetch(url);if(!file.ok){const error=await file.json() as {error?:string};throw Error(error.error||'Не удалось скачать Excel');}
 const blob=URL.createObjectURL(await file.blob()),link=document.createElement('a');link.href=blob;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(blob),1000);
}
