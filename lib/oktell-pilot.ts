import {z} from 'zod';

const clock=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const pilotSchema=z.object({
 name:z.string().trim().min(1).max(100),
 state:z.enum(['draft','paused']),
 native:z.object({projectId:z.string().uuid(),taskId:z.string().uuid(),listId:z.string().uuid(),verifiedAt:z.string().datetime(),active:z.literal(false),operatorUserIds:z.array(z.string().uuid()).length(2),line:z.string().min(1).max(100)}).strict().optional(),
 contacts:z.array(z.object({name:z.string().min(1).max(100),phone:z.string().regex(/^\+7\d{10}$/)}).strict()).length(3),
 operatorIds:z.array(z.string().regex(/^E-[a-zA-Z0-9-]+$/)).length(2),
 mode:z.literal('predictive'),
 ringSeconds:z.number().int().min(10).max(120),
 maxAttempts:z.number().int().min(1).max(10),
 order:z.literal('attempt_count_ascending'),
 timezone:z.literal('Europe/Moscow'),
 schedule:z.array(z.object({day:z.number().int().min(1).max(7),from:clock,to:clock}).strict()).min(1).max(21),
 clientWindow:z.object({from:clock,to:clock}).strict(),
 retries:z.array(z.object({result:z.enum(['busy','no_answer','declined','lost','answering_machine','error']),kind:z.enum(['not_before','after']),minutes:z.number().int().min(1).max(10080),attempts:z.number().int().min(1).max(10)}).strict()).length(6),
 results:z.array(z.string().min(1).max(80)).min(1).max(20),
 telephony:z.literal('existing_oktell_only'),
}).strict().superRefine((p,c)=>{
 const fail=(message:string)=>c.addIssue({code:z.ZodIssueCode.custom,message});
 if(p.state==='paused'&&!p.native)fail('Для сохранённого проекта нужна проверенная привязка Oktell');
 if(p.native&&new Set(p.native.operatorUserIds).size!==2)fail('Нужны две разные учётные записи Oktell');
 if(new Set(p.contacts.map(x=>x.phone)).size!==3)fail('Нужны три разных тестовых номера');
 if(new Set(p.operatorIds).size!==2)fail('Выберите двух разных операторов');
 if(new Set(p.retries.map(x=>x.result)).size!==6)fail('Для каждого исхода нужно одно правило повторов');
 if(p.clientWindow.from>=p.clientWindow.to)fail('Начало окна клиента должно предшествовать окончанию');
 for(const s of p.schedule){
  if(s.from>=s.to)fail('Начало рабочего интервала должно предшествовать окончанию');
  if(p.schedule.some(t=>t!==s&&t.day===s.day&&s.from<t.to&&t.from<s.to))fail('Интервалы расписания пересекаются');
 }
});
export type OktellPilot=z.infer<typeof pilotSchema>;
export const pilotSetting='oktell-pilot-t1';
export function pilotOperatorLinked(employee:{role:string;oktell?:{requested:boolean;status:string;userId?:string;login:string}}){
 return employee.role==='operator'&&employee.oktell?.requested===true&&employee.oktell.status==='linked'&&!!employee.oktell.userId;
}
