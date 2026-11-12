import type {ActivityDb} from './activity-store.ts';

export class SkProviderDeferred extends Error {
 retryAt:number;
 constructor(retryAt:number){super('Скорозвон: запрос отложен до окончания общей паузы');this.retryAt=retryAt;}
}
export async function initSkProvider(d:ActivityDb){
 await d.prepare('CREATE TABLE IF NOT EXISTS sk_api_control(id INTEGER PRIMARY KEY CHECK(id=1),next_at INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0,report_token TEXT NOT NULL DEFAULT \'\',report_until INTEGER NOT NULL DEFAULT 0)').run();
 await d.prepare('INSERT OR IGNORE INTO sk_api_control(id) VALUES(1)').run();
}
// Ingress and activity share four starts/second; a report owns only its endpoint, never the whole API.
export async function skProviderRequest(d:ActivityDb,request:typeof fetch,url:string,init:RequestInit,clock:()=>number,wait:(ms:number)=>Promise<void>,handleCooldown=true){
 await initSkProvider(d);
 const now=clock(),row=await d.prepare('UPDATE sk_api_control SET next_at=MAX(next_at,?)+250 WHERE id=1 AND retry_at<=? RETURNING next_at-250 AS slot').bind(now,now).first();
 if(!row)throw new SkProviderDeferred(Number(await d.prepare('SELECT retry_at FROM sk_api_control WHERE id=1').first('retry_at')));
 if(row.slot>now)await wait(row.slot-now);
 const cooldown=Number(await d.prepare('SELECT retry_at FROM sk_api_control WHERE id=1').first('retry_at'));
 if(cooldown>clock())throw new SkProviderDeferred(cooldown);
 const report=new URL(url).pathname==='/api/reports/calls_total.json',token=crypto.randomUUID();
 if(report){
  const claimed=await d.prepare('UPDATE sk_api_control SET report_token=?,report_until=? WHERE id=1 AND report_until<=?').bind(token,clock()+35000,clock()).run();
  if(!claimed.meta.changes)throw new SkProviderDeferred(clock()+1000);
 }
 try{
  const response=await request(url,init);
  if(response.status===429&&handleCooldown){
   const header=response.headers.get('Retry-After'),at=clock(),delay=header===null?60000:/^\d+$/.test(header)?Number(header)*1000:Date.parse(header)-at;
   await d.prepare('UPDATE sk_api_control SET retry_at=MAX(retry_at,?) WHERE id=1').bind(at+Math.max(60000,Number.isFinite(delay)?delay:60000)).run();
  }
  // Report concurrency includes receiving the body, not just receiving its headers.
  return report?new Response(await response.arrayBuffer(),{status:response.status,statusText:response.statusText,headers:response.headers}):response;
 }finally{if(report)await d.prepare("UPDATE sk_api_control SET report_token='',report_until=0 WHERE id=1 AND report_token=?").bind(token).run();}
}
