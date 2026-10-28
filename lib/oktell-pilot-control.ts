import http from 'node:http';
export function pilotControl(path:string,body?:unknown):Promise<any>{return new Promise((resolve,reject)=>{
 const r=http.request({socketPath:process.env.OKTELL_CONTROL_SOCKET||'/run/sm-oktell-bridge/control.sock',path,method:body?'POST':'GET',headers:{'Content-Type':'application/json'}},s=>{
  let raw='';s.on('data',x=>{raw+=x;if(raw.length>1000000)r.destroy(Error('Ответ Oktell слишком большой'));});s.on('end',()=>{try{const data=JSON.parse(raw);if(s.statusCode!==200)reject(Object.assign(Error(data.error||'Oktell недоступен'),{status:s.statusCode}));else resolve(data);}catch(e){reject(e);}});
 });r.on('error',reject);r.setTimeout(12000,()=>r.destroy(Error('Oktell не ответил вовремя')));r.end(body?JSON.stringify(body):undefined);
});}
