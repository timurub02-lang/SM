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
 return Response.json(await replacementRoute(db(),p.number,p.caller||''));
 }catch{return Response.json({error:'Соединение временно недоступно'},{status:503});}
}
