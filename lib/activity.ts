import type {Employee} from './crm.ts';
export type WorkSchedule={days:number[];start:string;end:string;breakMinutes:number};
export type ActivitySample={employeeId:string;skId:number;locked:boolean;calls:number;lastCallAt:string;lastCallEnd:string;callSeconds:number;observedAt:string;status:string;statusAt:string;breakSeconds:number;breakObservedSince:string;lastBusyAt:string;breakEndedAt:string;day:string};
export type ActivityRow={id:string;name:string;login:string;department:string;linked:boolean;state:string;label:string;idleMinutes:number|null;lastCrmAt:string;crmCount:number;lastCallAt:string;lastCallEnd:string;calls:number;callSeconds:number;breakMinutes:number;breakLimit:number;breakObservedSince:string;skStatus:string;statusAt:string;locked:boolean};
export function visibleActivityEmployee(actor:Employee,e:Employee){return actor.role==='admin'||actor.role==='department_head'&&!!actor.department&&e.department===actor.department;}
export function shiftWindow(schedule:WorkSchedule|undefined,now:number){
 if(!schedule)return null;
 const local=new Date(now+3*3600000),date=local.toISOString().slice(0,10);
 return {start:Date.parse(`${date}T${schedule.start}:00+03:00`),end:Date.parse(`${date}T${schedule.end}:00+03:00`),day:date,workday:schedule.days.includes(local.getUTCDay())};
}
export function activityRow(e:Employee,schedule:WorkSchedule|undefined,sample:ActivitySample|undefined,crm:{at:string;count:number},now=Date.now()):ActivityRow{
 const shift=shiftWindow(schedule,now),fresh=!!sample&&now-Date.parse(sample.observedAt)<180000,knownStatus=fresh&&!!sample.statusAt&&sample.status!=='unknown';
 const base=Math.max(shift?.start||0,Date.parse(crm.at)||0,Date.parse(sample?.lastCallEnd||sample?.lastCallAt||'')||0,Date.parse(sample?.lastBusyAt||'')||0,Date.parse(sample?.breakEndedAt||'')||0);
 const idleMinutes=shift?Math.max(0,Math.floor((Math.min(now,shift.end)-base)/60000)):null;
 let state='active',label='Есть рабочая активность';
 if(!shift){state='unknown';label='График не задан';}
 else if(!shift.workday||now<shift.start||now>=shift.end){state='off';label='Вне смены';}
 else if(sample?.locked){state='unknown';label='Учётная запись СК заблокирована';}
 else if(!sample){state='unknown';label='Скорозвон не связан';}
 else if(!fresh){state='unknown';label='Данные СК устарели';}
 else if(knownStatus&&['speaking','ringing'].includes(sample.status)){label=sample.status==='speaking'?'В разговоре':'Набирает номер';}
 else if(knownStatus&&sample.status==='away'){state=sample.breakSeconds>schedule!.breakMinutes*60?'idle':'break';label=state==='break'?'Перерыв':'Превышено время обеда';}
 else if(!knownStatus){state='unknown';label='Текущий статус СК не подтверждён';}
 else if(idleMinutes!==null&&idleMinutes>=60){state='idle';label='Нет рабочих действий более часа';}
 else if(idleMinutes!==null&&idleMinutes>=30){state='warning';label='Нет рабочих действий более 30 минут';}
 if(state==='active'&&knownStatus&&sample.status==='offline')state='off';
 if((state==='active'||state==='off')&&shift?.workday&&now>=shift.start&&now<shift.end&&knownStatus)label=({normal:'Ожидает звонка',available:'Ожидает звонка',wrapup:'Заполняет карточку',dnd:'Не беспокоить',offline:'Не в сети',accident:'Отстранён'} as Record<string,string>)[sample.status]||label;
 return {id:e.id,name:e.alias||e.name,login:e.login,department:e.department||'',linked:!!sample,state,label,idleMinutes,lastCrmAt:crm.at,crmCount:crm.count,lastCallAt:sample?.lastCallAt||'',lastCallEnd:sample?.lastCallEnd||'',calls:sample?.calls||0,callSeconds:sample?.callSeconds||0,breakMinutes:Math.floor((sample?.breakSeconds||0)/60),breakLimit:schedule?.breakMinutes||0,breakObservedSince:sample?.breakObservedSince||'',skStatus:knownStatus?sample?.status||'unknown':'unknown',statusAt:sample?.statusAt||'',locked:!!sample?.locked};
}
