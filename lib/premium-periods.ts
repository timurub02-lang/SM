import y2025 from './calendars/ru-2025.json' with {type:'json'};
import y2026 from './calendars/ru-2026.json' with {type:'json'};
import y2027 from './calendars/ru-2027.json' with {type:'json'};

const calendars=[y2025,y2026,y2027];
const years=new Set(calendars.map(c=>c.year));
const pad=(n:number)=>String(n).padStart(2,'0');
const holidays=new Set(calendars.flatMap(c=>c.months.flatMap(m=>m.days.split(',').filter(day=>!day.endsWith('*')).map(day=>`${c.year}-${pad(m.month)}-${pad(parseInt(day))}`))));
export const shiftDate=(day:string,n:number)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export function workingDay(day:string){
 if(!years.has(Number(day.slice(0,4))))throw Error('Для этого года производственный календарь ещё не настроен');
 return !holidays.has(day);
}
export function premiumCutoff(nominal:string){
 let cursor=shiftDate(nominal,-1),remaining=4;
 // Four full working days between cutoff and NOMINAL payday: Oct 26 -> Nov 1.
 while(remaining){if(workingDay(cursor))remaining--;cursor=shiftDate(cursor,-1);}
 return cursor;
}
const months=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
export type PremiumPeriod={id:string;label:string;from:string;cutoff:string;nominal:string;payout:string};
export function premiumPeriod(year:number,month:number,half:1|2):PremiumPeriod|null{
 const day=(offset:number,date:number)=>new Date(Date.UTC(year,month-1+offset,date,12)).toISOString().slice(0,10);
 const nominal=half===1?day(0,15):day(1,1),previous=half===1?day(0,1):day(0,15);
 try{
  let payout=nominal;while(!workingDay(payout))payout=shiftDate(payout,-1);
  return {id:`${year}-${pad(month)}-${half}`,label:`${months[month-1]} ${year} · ${half}-й период`,from:shiftDate(premiumCutoff(previous),1),cutoff:premiumCutoff(nominal),nominal,payout};
 }catch{return null;}
}
// Unsupported dates remain in a visible separate group, never silently assigned by weekdays alone.
export const premiumPeriods=[2026,2027].flatMap(year=>Array.from({length:12},(_,m)=>([1,2] as const).map(h=>premiumPeriod(year,m+1,h)))).flat().filter((p):p is PremiumPeriod=>!!p);
export const periodForReceipt=(date:string)=>premiumPeriods.find(p=>date>=p.from&&date<=p.cutoff);
export const currentPremiumPeriod=(today:string)=>premiumPeriods.find(p=>p.nominal>=today);
