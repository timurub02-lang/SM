import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {initCdekUnmatched} from '@/lib/cdek-unmatched';
import type {CdekRemittance} from '@/lib/cdek-remittance';
export const dynamic='force-dynamic';
export const GET=authenticated(async(req:Request)=>{
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 const q=new URL(req.url).searchParams,d=db();
 const actor=await d.prepare("SELECT json_extract(data,'$.role') role FROM employees WHERE id=?").bind(q.get('actorId')||'').first<{role:string}>();
 if(actor?.role!=='admin')return Response.json({error:'Доступно только администратору'},{status:403});
 const page=Number(q.get('page')||0);
 if(!Number.isSafeInteger(page)||page<0||page>100000)return Response.json({error:'Неверная страница'},{status:400});
 await initCdekUnmatched(d);
 const total=(await d.prepare('SELECT COUNT(*) n FROM cdek_unmatched_remittances WHERE payment_date >= ?').bind('2026-10-01').first<{n:number}>())?.n||0;
 const rows=await d.prepare('SELECT receipt FROM cdek_unmatched_remittances WHERE payment_date >= ? ORDER BY payment_date DESC,receipt LIMIT 50 OFFSET ?').bind('2026-10-01',page*50).all<{receipt:string}>();
 return Response.json({total,rows:rows.results.map(r=>JSON.parse(r.receipt) as CdekRemittance)},{headers:{'Cache-Control':'no-store'}});
});
