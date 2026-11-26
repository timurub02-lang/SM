import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {readLimitedText} from '@/lib/request-body';
import {db} from '@/lib/db';
import {ledgerKey,type PremiumLedger} from '@/lib/premium-ledger';
import {defaultPremiumRounding,roundsPremium} from '@/lib/premium-calculation';
import type {Employee} from '@/lib/crm';
import {z} from 'zod';
const schema=z.object({actorId:z.string().optional(),revision:z.string().max(80),rounding:z.object({'1':z.boolean(),'2':z.boolean(),'3':z.boolean(),'4':z.boolean(),'5':z.boolean()}).strict()}).strict();
export const dynamic='force-dynamic';
async function handle(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 const d=db(),id=new URL(req.url).searchParams.get('actorId')||'';
 const row=await d.prepare('SELECT data FROM employees WHERE id=?').bind(id).first<{data:string}>();
 const actor:Employee|undefined=row?JSON.parse(row.data):undefined;
 if(!actor||!['admin','operator','department_head'].includes(actor.role)||req.method==='POST'&&actor.role!=='admin')return Response.json({error:'Настройки изменяет администратор'},{status:403});
 const stored=await d.prepare(req.method==='GET'?"SELECT json_object('revision',json_extract(data,'$.revision'),'rounding',json_extract(data,'$.rounding')) AS data FROM settings WHERE id=?":'SELECT data FROM settings WHERE id=?').bind(ledgerKey).first<{data:string}>();
 const ledger:PremiumLedger|null=stored?JSON.parse(stored.data):null;
 const response=(value:PremiumLedger|null)=>({revision:value?.revision||'',rounding:{...defaultPremiumRounding,...value?.rounding},roundTo50:roundsPremium(actor.department,value?.rounding??defaultPremiumRounding),initialized:!!value});
 if(req.method==='GET')return Response.json(response(ledger),{headers:{'Cache-Control':'no-store'}});
 try{
  const body=schema.parse(JSON.parse(await readLimitedText(req,3000)));
  if(!ledger)return Response.json({error:'Сначала откройте расчётный период премии'},{status:409});
  if(body.revision!==ledger.revision)return Response.json({error:'Расчёт или настройки изменились. Откройте настройки заново.'},{status:409});
  const next={...ledger,rounding:body.rounding,revision:crypto.randomUUID()};
  const result=await d.prepare('UPDATE settings SET data=? WHERE id=? AND data=?').bind(JSON.stringify(next),ledgerKey,stored!.data).run();
  if(!result.meta.changes)return Response.json({error:'Расчёт изменился. Откройте настройки заново.'},{status:409});
  return Response.json(response(next));
 }catch{return Response.json({error:'Проверьте настройки округления'},{status:400});}
}
export const GET=authenticated(handle);
export const POST=authenticated(handle);
