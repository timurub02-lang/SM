import {db} from '@/lib/db';
import {trustedPbx} from '@/lib/phone-pbx-auth';
import {initReplacement,replacementRoute} from '@/lib/phone-replacement';
export const dynamic='force-dynamic';
export async function GET(req:Request){if(!trustedPbx(req))return Response.json({error:'Запрещено'},{status:401});await initReplacement(db());return Response.json({numbers:(await db().prepare('SELECT number FROM replacement_numbers ORDER BY number').all()).results.map((r:any)=>r.number)});}
export async function POST(req:Request){
 if(!trustedPbx(req))return Response.json({error:'Запрещено'},{status:401});
 try{const raw=await req.text();if(raw.length>250000)throw Error();const p=JSON.parse(raw);await initReplacement(db());
 if(p.action==='heartbeat'){
 const numbers=(await db().prepare('SELECT number FROM replacement_numbers ORDER BY number').all()).results.map((r:any)=>r.number);
 if(JSON.stringify(p.numbers)!==JSON.stringify(numbers))throw Error('Пул АТС устарел');
 await db().prepare("INSERT INTO settings(id,data) VALUES('phone-replacement-health',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify({at:new Date().toISOString(),numbers})).run();return Response.json({ok:true});
 }
 if(typeof p.number!=='string'||!/^\+?7\d{10}$/.test(p.number))throw Error('Некорректный номер');
 if(p.caller!==undefined&&(typeof p.caller!=='string'||p.caller.length>40))throw Error('Некорректный звонящий');
 const route=await replacementRoute(db(),p.number,p.caller||'');
 if('destination' in route&&route.mode==='connect'&&typeof p.callId==='string'&&/^[a-f0-9]{32}$/.test(p.callId)){
  await db().prepare(`INSERT OR IGNORE INTO replacement_calls(id,assignment_id,order_id,caller_number,destination,direction,claimed_at) SELECT ?,id,order_id,?,?,?,? FROM replacement_assignments WHERE id=? AND released_at IS NULL`).bind(p.callId,p.caller||'',route.destination!,route.direction!,new Date().toISOString(),route.assignmentId!).run();
 }
 return Response.json(route);
 }catch{return Response.json({error:'Соединение временно недоступно'},{status:503});}
}
