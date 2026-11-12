import {authenticated} from '@/lib/api-auth';
import {legacyBackgroundExport} from '@/lib/legacy-background-export';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {baseWorkbook} from '@/lib/base-export';
import type ExcelJS from 'exceljs';
export const GET=authenticated(async req=>{
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});const url=new URL(req.url),actor=await db().prepare('SELECT data FROM employees WHERE id=?').bind(url.searchParams.get('actorId')||'').first<{data:string}>();if(!actor||JSON.parse(actor.data).role!=='admin')return Response.json({error:'Доступно администратору'},{status:403});
 const base=url.searchParams.get('base');if(base!=='M'&&base!=='J')return Response.json({error:'Выберите М или Ж'},{status:400});
 const background=await legacyBackgroundExport(req,'base',base);if(background)return background;
 const book=await baseWorkbook(db(),base);
 const content=await (book as ExcelJS.Workbook).xlsx.writeBuffer();return new Response(new Uint8Array(content),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="base-${base}.xlsx"`,'Cache-Control':'no-store'}});
});
