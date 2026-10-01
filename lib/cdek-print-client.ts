export async function requestCdekPrint(body:Record<string,unknown>){
 for(let attempt=0;attempt<10;attempt++){
  const response=await fetch('/api/cdek/shipment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,action:'print'})});
  if(response.status!==202||attempt===9)return response;
  await new Promise(resolve=>setTimeout(resolve,1500));
 }
 throw Error('Не удалось получить накладную');
}
