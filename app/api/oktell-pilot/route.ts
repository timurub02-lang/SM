import {sessionEmployee,trustedOrigin} from '@/lib/auth';
import {hasOktellLink} from '@/lib/oktell-link';
import {pilotControl} from '@/lib/oktell-pilot-control';
import {syncPilot} from '@/lib/oktell-pilot-sync';
import {db} from '@/lib/db';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 const a=await sessionEmployee(req.headers);
 if(!a||!hasOktellLink(a)||!trustedOrigin(req.headers))return Response.json({error:'Нет доступа'},{status:403});
 try{
  const raw=await req.text();if(raw.length>8000)return Response.json({error:'Слишком большой запрос'},{status:413});
  const b=JSON.parse(raw),path='/pilot?actor='+encodeURIComponent(a.id);
  if(b.action==='sync'&&Object.keys(b).length===1){await syncPilot(db());return Response.json(await pilotControl(path));}
  if(b.action!=='result')return Response.json({error:'Неверная команда'},{status:400});
  const {action,...body}=b;const result=await pilotControl(path,body);await syncPilot(db());return Response.json(result);
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Нет связи с Oktell'},{status:(e as any)?.status||502});}
}
