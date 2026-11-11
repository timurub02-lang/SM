// A lost response must not keep the form busy or automatically send another SMS.
export async function mainSmsRequest<T=any>(body?:Record<string,unknown>,query:Record<string,string>={},cancel?:AbortSignal):Promise<T>{
 const sending=body?.action==='send',timeout=AbortSignal.timeout(sending?45000:20000);
 const signal=cancel?AbortSignal.any([cancel,timeout]):timeout;
 try{
  const response=await fetch('/api/mainsms?'+new URLSearchParams(query),{
   method:body?'POST':'GET',signal,cache:'no-store',
   ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),
  });
  const data=await response.json() as T&{error?:string;message?:string};
  if(!response.ok)throw Error(data.error||data.message||'Ошибка MainSMS');
  return data;
 }catch(error){
  if(timeout.aborted)throw Error(sending
   ?'Ответ об отправке SMS не получен. Обновите историю и проверьте кабинет MainSMS перед повторной отправкой.'
   :'CRM не ответила вовремя. Повторите загрузку или предпросмотр.');
  if(error instanceof TypeError)throw Error(sending
   ?'Связь прервалась. Результат отправки SMS неизвестен. Проверьте историю и кабинет MainSMS перед повторной отправкой.'
   :'Не удалось связаться с CRM. Повторите загрузку или предпросмотр.');
  throw error;
 }
}
