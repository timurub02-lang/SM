import {hasOktellLink} from '@/lib/oktell-link';
import http from 'node:http';
import {z} from 'zod';
import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
export const dynamic='force-dynamic';
const input=z.object({action:z.enum(['ready','break','finish']),reason:z.enum(['Обед','Короткий перерыв']).optional()});
async function handle(req:Request){
 const actor=(await getChatGPTUser())?.employee;
 if(!actor||!hasOktellLink(actor))return Response.json({error:'Учётная запись Oktell ещё не подключена для этого сотрудника'},{status:403});
 try{
  const body=req.method==='POST'?{...input.parse(await req.json()),actor:actor.id}:undefined;
  return await new Promise<Response>((resolve,reject)=>{
   const call=http.request({socketPath:process.env.OKTELL_CONTROL_SOCKET||'/run/sm-oktell-bridge/control.sock',path:body?'/operator':'/operator?actor='+encodeURIComponent(actor.id),method:req.method,headers:{'Content-Type':'application/json'}},res=>{
    let raw='';res.on('data',chunk=>{raw+=chunk;if(raw.length>16000)call.destroy(Error('Response too large'));});res.on('error',reject);
    res.on('end',()=>{try{resolve(Response.json(JSON.parse(raw),{status:res.statusCode||502,headers:{'Cache-Control':'no-store'}}));}catch{reject(Error('Invalid response'));}});
   });
   call.setTimeout(45000,()=>call.destroy(Error('Timeout')));call.on('error',reject);call.end(body?JSON.stringify(body):undefined);
  });
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Выберите статус и причину перерыва':'Не удалось получить подтверждение Oktell. Обновите состояние перед повторной командой'},{status:e instanceof z.ZodError?400:502});}
}
export const GET=authenticated(handle);
export const POST=authenticated(handle);
