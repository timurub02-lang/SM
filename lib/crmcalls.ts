import {z} from 'zod';
import {normalizedPhone,workDate} from './base-distribution.ts';
import type {Client} from './crm.ts';

export const crmcallsProjectSchema=z.object({id:z.uuid(),name:z.string(),status:z.enum(['draft','active','paused','waiting_contacts','error','finished'])});
export type CRMCallsProject=z.infer<typeof crmcallsProjectSchema>;
export const crmcallsScheduleSchema=z.object({
 projectId:z.uuid(),base:z.enum(['M','J']),sheet:z.string().trim().min(1).max(31).refine(v=>!['К','ЧС','ПВ'].includes(v),'К, ЧС и ПВ не выгружаются'),
 cycleDays:z.number().int().min(1).max(366),sendTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),enabled:z.boolean(),
});
export type CRMCallsSchedule=z.infer<typeof crmcallsScheduleSchema>;
export class CRMCallsHttpError extends Error{status:number;constructor(status:number){super('CRMCalls: ошибка HTTP '+status);this.status=status;}}
export function crmcallsContact(c:Pick<Client,'id'|'name'|'phone'|'linkedPhones'|'city'|'address'>){
 const phone=normalizedPhone(c.phone);if(!phone)throw Error('Некорректный основной телефон');
 return {external_id:c.id,full_name:c.name||phone,phones:[...new Set([phone,...(c.linkedPhones||[]).map(normalizedPhone).filter(Boolean)])],city:c.city||'',address:c.address||''};
}
export function crmcallsPlan(total:number,days:number,start:string){
 const weekday=new Date(start+'T12:00:00Z').getUTCDay();if(weekday===0||weekday===6)start=workDate(start,1);
 return Array.from({length:days},(_,i)=>({date:workDate(start,i),count:Math.floor(total/days)}));
}
export function crmcallsApi(key:string,request:typeof fetch=fetch){
 let last=0;
 return async(path:string,body?:unknown)=>{
  const delay=150-(Date.now()-last);if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));last=Date.now();
  let response:Response;
  try{response=await request('https://cc.crmcalls.ru/api/v1'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw Error('CRMCalls не ответил. Результат отправки может быть неизвестен.');}
  if(!response.ok)throw new CRMCallsHttpError(response.status);
  try{return z.object({data:z.any(),pagination:z.object({total_pages:z.number().int().nonnegative()}).optional()}).parse(await response.json());}catch{throw Error('CRMCalls вернул некорректный ответ');}
 };
}
export async function crmcallsProjects(api:ReturnType<typeof crmcallsApi>){
 const projects:CRMCallsProject[]=[],ids=new Set<string>();
 for(let page=1;page<=100;page++){
  const reply=await api('/projects?per_page=200&page='+page),rows=z.array(crmcallsProjectSchema).parse(reply.data);
  for(const row of rows){if(ids.has(row.id))throw Error('CRMCalls повторил страницу проектов');ids.add(row.id);projects.push(row);}
  const pages=reply.pagination?.total_pages;
  if(typeof pages!=='number'||!Number.isInteger(pages)||pages<0)throw Error('CRMCalls не подтвердил страницы проектов');
  if(page>=pages)return projects;
 }
 throw Error('Слишком много страниц проектов CRMCalls');
}
