import {z} from 'zod';

const text=(max:number)=>z.string().trim().max(max);
const clock=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/,'Укажите время в формате ЧЧ:ММ');
const count=(min:number,max:number)=>z.number().int().min(min).max(max);
export const retryLabels={busy:'Занято',no_answer:'Нет ответа',declined:'Клиент отклонил вызов',lost:'Не хватило оператора',answering_machine:'Автоответчик',error:'Ошибка соединения'} as const;
export type RetryOutcome=keyof typeof retryLabels;
const outcomes=Object.keys(retryLabels) as [RetryOutcome,...RetryOutcome[]];
const period=z.object({day:count(1,7),from:clock,to:clock}).strict().refine(x=>x.from<x.to,{message:'Конец интервала должен быть позже начала',path:['to']});
const result=z.object({id:z.string().uuid(),name:text(100).min(1,'Введите название результата'),action:z.enum(['finish','callback','retry','exclude']),success:z.boolean()}).strict();
export const projectSettingsSchema=z.object({
 name:text(100).min(1,'Введите название проекта'),description:text(1000),
 mode:z.enum(['preview','progressive','predictive']),ringSeconds:count(10,180),maxLines:count(1,100),maxAttempts:count(1,30),
 order:z.enum(['least_attempts','oldest_first']),
 operatorIds:z.array(text(100).min(1)).max(100),distribution:z.enum(['longest_idle','round_robin']),
 schedule:z.array(period).max(28),timezone:z.enum(['Europe/Moscow','Europe/Kaliningrad','Europe/Samara','Asia/Yekaterinburg','Asia/Omsk','Asia/Novosibirsk','Asia/Krasnoyarsk','Asia/Irkutsk','Asia/Yakutsk','Asia/Vladivostok','Asia/Magadan','Asia/Kamchatka']),
 clientWindow:z.object({from:clock,to:clock,unknownTimezone:z.enum(['exclude','project_timezone'])}).strict().refine(x=>x.from<x.to,{message:'Конец времени клиента должен быть позже начала',path:['to']}),
 retries:z.array(z.object({outcome:z.enum(outcomes),minutes:count(1,10080),attempts:count(0,30)}).strict()).length(6),
 queue:z.object({enabled:z.boolean(),maxClients:count(1,100),maxWaitSeconds:count(5,600)}).strict(),
 source:z.object({kind:z.enum(['none','existing_native']),listId:z.union([z.literal(''),z.string().uuid()]),label:text(200)}).strict(),
 callerId:text(20).refine(x=>!x||/^\+?\d{5,15}$/.test(x),'Укажите номер цифрами, можно с +'),
 script:text(12000),results:z.array(result).max(40),callback:z.object({sameOperator:z.boolean(),fallbackMinutes:count(0,1440)}).strict(),
}).strict().superRefine((x,c)=>{
 if(new Set(x.operatorIds).size!==x.operatorIds.length)c.addIssue({code:'custom',path:['operatorIds'],message:'Оператор выбран дважды'});
 if(new Set(x.retries.map(r=>r.outcome)).size!==6)c.addIssue({code:'custom',path:['retries'],message:'Для каждого исхода нужно одно правило повторов'});
 if(new Set(x.results.map(r=>r.id)).size!==x.results.length||new Set(x.results.map(r=>r.name.toLocaleLowerCase('ru'))).size!==x.results.length)c.addIssue({code:'custom',path:['results'],message:'Названия и идентификаторы результатов не должны повторяться'});
 for(const r of x.results)if(r.success&&r.action!=='finish')c.addIssue({code:'custom',path:['results'],message:'Успешный результат должен завершать обработку'});
 if(x.source.kind==='existing_native'&&!x.source.listId)c.addIssue({code:'custom',path:['source'],message:'Выберите источник Oktell'});
 if(x.source.kind==='none'&&(x.source.listId||x.source.label))c.addIssue({code:'custom',path:['source'],message:'Очистите ссылку на отключённый источник'});
 for(let i=0;i<x.schedule.length;i++)for(let j=0;j<i;j++){
  const a=x.schedule[i],b=x.schedule[j];
  if(a.day===b.day&&a.from<b.to&&b.from<a.to)c.addIssue({code:'custom',path:['schedule',i],message:'Интервалы одного дня пересекаются'});
 }
});
export type ProjectSettings=z.infer<typeof projectSettingsSchema>;
export type ProjectDraft={id:string;revision:number;settings:ProjectSettings;createdAt:string;updatedAt:string;updatedBy:string;status:'draft'};
export type ProjectHistory={revision:number;at:string;actor:string;settings:ProjectSettings};
export const settingsCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),id:z.string().uuid(),settings:projectSettingsSchema}).strict(),
 z.object({action:z.literal('save'),id:z.string().uuid(),revision:count(1,2147483646),settings:projectSettingsSchema}).strict(),
]);
export function newProjectSettings(template:'blank'|'t1'='blank'):ProjectSettings{
 const t1=template==='t1';
 return {name:t1?'Т1 · новый проект':'Новый проект',description:'',mode:t1?'predictive':'progressive',ringSeconds:50,maxLines:t1?6:1,maxAttempts:3,order:'least_attempts',operatorIds:[],distribution:'longest_idle',timezone:'Europe/Moscow',
 schedule:t1?[
  {day:1,from:'07:00',to:'21:00'},{day:2,from:'07:00',to:'20:00'},{day:3,from:'07:00',to:'20:00'},
  {day:4,from:'06:00',to:'20:00'},{day:5,from:'06:00',to:'20:00'},{day:6,from:'06:00',to:'07:00'},
  {day:6,from:'08:00',to:'20:00'},{day:7,from:'08:00',to:'21:30'},
 ]:[1,2,3,4,5].map(day=>({day,from:'09:00',to:'18:00'})),
 clientWindow:{from:'09:00',to:'20:00',unknownTimezone:'exclude'},
 retries:outcomes.map(outcome=>({outcome,minutes:outcome==='declined'?60:outcome==='lost'?5:30,attempts:t1?5:3})),
 queue:{enabled:false,maxClients:1,maxWaitSeconds:30},source:{kind:'none',listId:'',label:''},callerId:'',script:'',results:[],callback:{sameOperator:true,fallbackMinutes:30}};
}
export function settingsChecklist(s:ProjectSettings){return [
 {key:'operators',label:'Выбрать операторов',complete:s.operatorIds.length>0},
 {key:'source',label:'Подключить базу клиентов',complete:s.source.kind!=='none'},
 {key:'schedule',label:'Задать расписание',complete:s.schedule.length>0},
 {key:'results',label:'Добавить результаты разговора',complete:s.results.length>0},
 {key:'native',label:'Применить настройки в Oktell',complete:false},
 ];}
