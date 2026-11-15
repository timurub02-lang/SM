export type PartnerMinutes={updatedAt:string;through:string;rows:{employeeId:string;login:string;billed:number;seconds:number}[];missing:string[]};
export function communicationCents(settings:{communication:number;minutePrice?:number;minutes?:PartnerMinutes}):number|null{
 const price=settings.minutePrice??0;
 if(price>0&&(!settings.minutes||settings.minutes.missing.length))return null;
 return Math.round(settings.communication*100)+(settings.minutes?.rows||[]).reduce((sum,row)=>sum+Math.round(row.billed*price*100),0);
}
export function actualTime(seconds:number){const s=Math.round(seconds);return `${Math.floor(s/3600)} ч ${Math.floor(s%3600/60)} мин ${s%60} сек`;}

export function minutesFinal(calendar:{cutoff:string},minutes:PartnerMinutes|undefined,now=Date.now()):boolean{
 const end=Date.parse(calendar.cutoff+'T23:59:59+03:00');
 return now>end&&!!minutes&&minutes.missing.length===0&&Date.parse(minutes.through)>=end;
}
