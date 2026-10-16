import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {initIncoming} from '@/lib/incoming';
import {protectionConfig,protectionSchema,moderateIncoming} from '@/lib/incoming-protection';
import {z} from 'zod';
export const dynamic='force-dynamic';
export const GET=authenticated(async()=>{
 const e=(await getChatGPTUser())?.employee;if(e?.role!=='admin')return Response.json({error:'Недостаточно прав'},{status:403});
 const d=db();await initIncoming(d);
 return Response.json({config:await protectionConfig(d),state:await d.prepare('SELECT until_at FROM incoming_protection_state WHERE id=1').first()});
});
export const POST=authenticated(async req=>{
 const e=(await getChatGPTUser())?.employee;if(e?.role!=='admin')return Response.json({error:'Недостаточно прав'},{status:403});
 try{const d=db();await initIncoming(d);const p=await req.json() as any;
 if(p.operation==='settings'){const config=protectionSchema.parse(p.config);await d.batch([
 d.prepare("INSERT INTO settings(id,data) VALUES('incoming-protection',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify(config)),
 d.prepare('INSERT INTO incoming_protection_audit(at,actor,operation,target) VALUES(?,?,?,?)').bind(new Date().toISOString(),e.id,'settings',JSON.stringify(config))
 ]);}
 else await moderateIncoming(d,e,z.object({id:z.string().min(1).max(100),operation:z.enum(['restore','spam','block','unblock'])}).parse(p));
 return Response.json({ok:true});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Ошибка сохранения'},{status:400});}
});
