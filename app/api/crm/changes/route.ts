import {personalAuth,sessionEmployee} from '@/lib/auth';
import {db} from '@/lib/db';
import {initCrmChangeClock,crmChangeRevision} from '@/lib/crm-change-clock';
export const dynamic='force-dynamic';

export async function GET(request:Request){
 if(!personalAuth()||!await sessionEmployee(request.headers))return Response.json({error:'Требуется вход'},{status:401});
 const d=db();await initCrmChangeClock(d);
 const encoder=new TextEncoder();let timer:ReturnType<typeof setTimeout>|undefined;let stopped=false;
 const stop=()=>{stopped=true;if(timer)clearTimeout(timer);request.signal.removeEventListener('abort',abort);};
 let close:()=>void=()=>{};
 const abort=()=>{stop();close();};
 const body=new ReadableStream<Uint8Array>({
  start(controller){
   close=()=>{try{controller.close();}catch{}};
   let previous=request.headers.get('last-event-id')||'';const started=Date.now();
   const tick=async()=>{
    try{
     if(stopped)return;
     // Reconnect rechecks the session; the durable clock recovers missed invalidations.
     if(Date.now()-started>=25000){stop();close();return;}
     const revision=await crmChangeRevision(d);if(stopped)return;
     if(revision!==previous){
      if(!await sessionEmployee(request.headers)){stop();close();return;}
      if(stopped)return;
      previous=revision;controller.enqueue(encoder.encode(`id: ${revision}\nevent: change\ndata: {}\n\n`));
     }else controller.enqueue(encoder.encode(': heartbeat\n\n'));
     timer=setTimeout(()=>void tick(),1000);
    }catch{stop();close();}
   };
   request.signal.addEventListener('abort',abort,{once:true});
   if(request.signal.aborted)abort();else void tick();
  },
  cancel(){stop();},
 });
 return new Response(body,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
}
