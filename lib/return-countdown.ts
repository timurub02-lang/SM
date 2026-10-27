export function returnCountdown(deadline:string, startsAt:string|undefined, now:number){
 const start=startsAt?Date.parse(startsAt):0;
 const waiting=start>now;
 const end=waiting?start:Date.parse(deadline);
 if(!Number.isFinite(end))return 'Срок не указан';
 if(end<=now)return 'Время истекло';
 const minutes=Math.ceil((end-now)/60000);
 const time=minutes>=60?`${Math.floor(minutes/60)} ч ${minutes%60} мин`:`${minutes} мин`;
 return waiting?`До начала: ${time}`:`Осталось ${time}`;
}
