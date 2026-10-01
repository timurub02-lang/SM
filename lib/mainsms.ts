import {createHash} from 'node:crypto';
import {z} from 'zod';
export const smsTemplate=z.object({id:z.string().min(1).max(80),name:z.string().trim().min(1).max(100),text:z.string().trim().min(1).max(1000)});
export const smsConfig=z.object({project:z.string().trim().min(1).max(100),sender:z.string().trim().max(30),apiKey:z.string().max(300),templates:z.array(smsTemplate).max(100)}).refine(v=>new Set(v.templates.map(t=>t.id)).size===v.templates.length,'Повторяются шаблоны');
export function smsText(text:string,name:string,orderId:string){const result=text.replaceAll('{client}',name).replaceAll('{order}',orderId);if(/\{[^}]+\}/.test(result))throw Error('Разрешены только {client} и {order}');if(result.length>1000)throw Error('SMS слишком длинное');return result;}
export function smsSign(params:Record<string,string>,key:string){return createHash('md5').update(createHash('sha1').update(Object.keys(params).sort().map(k=>params[k]).join(';')+';'+key).digest('hex')).digest('hex');}
export async function mainSmsCall(config:{project:string;apiKey:string},method:'send'|'balance',params:Record<string,string>={}){
 const values={...params,project:config.project};const r=await fetch('https://mainsms.ru/api/mainsms/message/'+method,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...values,sign:smsSign(values,config.apiKey)}),signal:AbortSignal.timeout(20000)});
 const data=await r.json() as {status:string;messages_id?:number[];balance?:number;error?:number;price?:number};
 if(!r.ok||data.status!=='success')throw Error(`MainSMS отклонил запрос (код ${data.error??r.status}). Проверьте проект, ключ, отправителя и баланс.`);
 return data;
}
