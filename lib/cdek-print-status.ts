export function cdekPrintStatus(statuses:{code:string;date_time:string}[]=[]){
 // CDEK can report all print stages within one second; the later array entry wins ties.
 return [...statuses].reverse().sort((a,b)=>b.date_time.localeCompare(a.date_time))[0]?.code;
}
