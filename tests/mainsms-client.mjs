import assert from 'node:assert/strict';
import {mainSmsRequest} from '../lib/mainsms-client.ts';
const originalFetch=globalThis.fetch,originalTimeout=AbortSignal.timeout;
let deadline,milliseconds,calls;
try{
 AbortSignal.timeout=ms=>{milliseconds=ms;deadline=new AbortController();return deadline.signal;};
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'/api/mainsms?orderId=test');assert.equal(options.cache,'no-store');
  return Response.json({history:[]});
 };
 assert.deepEqual(await mainSmsRequest(undefined,{orderId:'test'}),{history:[]});assert.equal(milliseconds,20000);
 globalThis.fetch=async()=>Response.json({error:'Нет доступа'},{status:403});
 await assert.rejects(mainSmsRequest(),/Нет доступа/);
 globalThis.fetch=async()=>Response.json({message:'Принято'});
 assert.equal((await mainSmsRequest({action:'send'})).message,'Принято');assert.equal(milliseconds,45000);
 // Both connection waits and a body that never arrives must release the UI.
 for(const duringBody of [false,true]){
  calls=0;
  globalThis.fetch=async(url,options)=>{
   calls++;
   const waiting=()=>new Promise((resolve,reject)=>{if(options.signal.aborted)reject(options.signal.reason);else options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
   return duringBody?{json:waiting}:waiting();
  };
  for(const action of ['preview','send']){
   const pending=mainSmsRequest({action});
   const rejected=assert.rejects(pending,action==='send'?/Проверьте|проверьте/:/не ответила вовремя/);
   deadline.abort(new DOMException('Timeout','TimeoutError'));await rejected;
  }
  assert.equal(calls,2,'A timeout must never automatically retry a paid send');
 }
 const cancel=new AbortController();
 globalThis.fetch=async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
 const pending=mainSmsRequest(undefined,{},cancel.signal),cancelled=assert.rejects(pending,{name:'AbortError'});
 cancel.abort();await cancelled;
 globalThis.fetch=async()=>{throw new TypeError('Failed to fetch');};
 await assert.rejects(mainSmsRequest({action:'send'}),/Результат отправки SMS неизвестен/);
 console.log('SMS request/body timeouts, cancellation, errors and no automatic paid retries passed.');
}finally{globalThis.fetch=originalFetch;AbortSignal.timeout=originalTimeout;}
