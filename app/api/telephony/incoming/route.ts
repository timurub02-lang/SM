import {z} from 'zod';
import {db} from '@/lib/db';
import {trustedPbx} from '@/lib/phone-pbx-auth';
import {receiveIncoming} from '@/lib/incoming';
export const dynamic='force-dynamic';
const schema=z.object({id:z.string().regex(/^[a-f0-9]{32}$/),phone:z.string().max(40),calledNumber:z.string().max(40),at:z.string().datetime()});
export async function POST(req:Request){
 if(!trustedPbx(req))return Response.json({error:'Forbidden'},{status:403});
 try{
  const reader=req.body?.getReader();if(!reader)throw Error('Empty');let size=0;const chunks:Uint8Array[]=[];
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return Response.json({error:'Too large'},{status:413});}chunks.push(value);}
  const p=schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if(Date.parse(p.at)>Date.now()+60000)throw Error('Invalid time');
  await receiveIncoming(db(),p);return Response.json({ok:true});
 }catch{return Response.json({error:'Invalid incoming call'},{status:400});}
}
