// Fixed metric names only. No request body, account IDs or customer data are logged.
export class RequestTiming {
 private started:number;
 private samples:{name:string;duration:number}[]=[];
 constructor(privateNow:()=>number=()=>performance.now()) {this.now=privateNow;this.started=this.now();}
 private now:()=>number;
 async measure<T>(name:'read'|'snapshot',operation:()=>Promise<T>):Promise<T> {
  const start=this.now();
  try{return await operation();}
  finally{this.samples.push({name,duration:Math.max(0,this.now()-start)});}
 }
 finish(response:Response):Response {
  const metrics=[...this.samples,{name:'total',duration:Math.max(0,this.now()-this.started)}];
  response.headers.set('Server-Timing',metrics.map(x=>`crm_${x.name};dur=${x.duration.toFixed(1)}`).join(', '));
  return response;
 }
}
