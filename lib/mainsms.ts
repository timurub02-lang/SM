import {createHash} from 'node:crypto';
import {z} from 'zod';
export const smsTemplate=z.object({id:z.string().min(1).max(80),name:z.string().trim().min(1).max(100),text:z.string().trim().min(1).max(1000)});
export const smsConfig=z.object({project:z.string().trim().min(1).max(100),sender:z.string().trim().max(30),apiKey:z.string().max(300),templates:z.array(smsTemplate).max(100)}).refine(v=>new Set(v.templates.map(t=>t.id)).size===v.templates.length,'Повторяются шаблоны');
export function smsText(text:string,name:string,orderId:string){const result=text.replaceAll('{client}',name).replaceAll('{order}',orderId);if(/\{[^}]+\}/.test(result))throw Error('Разрешены только {client} и {order}');if(result.length>1000)throw Error('SMS слишком длинное');return result;}
export function smsSign(params:Record<string,string>,key:string){return createHash('md5').update(createHash('sha1').update(Object.keys(params).sort().map(k=>params[k]).join(';')+';'+key).digest('hex')).digest('hex');}
export class MainSmsRejection extends Error {}
const rejectionReasons:Record<number,string>={1:'Не указан проект MainSMS',2:'MainSMS отклонил подпись запроса или кодировку',3:'Пустой текст SMS',4:'Не указан получатель',5:'Проект MainSMS не найден',6:'Неверный формат номера получателя',7:'Недостаточно средств на счёте MainSMS',8:'Неверное имя отправителя',9:'Имя отправителя не подтверждено',10:'Проект MainSMS приостановлен'};
export async function mainSmsCall(config:{project:string;apiKey:string},method:'send'|'balance'|'status',params:Record<string,string>={}){
 const values={...params,project:config.project};const r=await fetch('https://mainsms.ru/api/mainsms/message/'+method,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...values,sign:smsSign(values,config.apiKey)}),signal:AbortSignal.timeout(method==='status'?5000:20000)});
 const data=await r.json() as {status:string;messages_id?:number[];balance?:number;error?:number;price?:number;messages?:Record<string,string>};
 if(r.ok&&data.status==='error'&&data.error&&rejectionReasons[data.error])throw new MainSmsRejection(rejectionReasons[data.error]+` (код ${data.error})`);
 if(!r.ok||data.status!=='success')throw Error(`MainSMS отклонил запрос (код ${data.error??r.status}). Проверьте проект, ключ, отправителя и баланс.`);
 return data;
}
