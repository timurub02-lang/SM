import {authenticated} from '@/lib/api-auth';
import {db} from '@/lib/db';
import {readOfficialPdf} from '@/lib/premium-pdf';
import {officialPreview,applyOfficialImport} from '@/lib/premium-official-import';
import {z} from 'zod';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const schema=z.object({action:z.enum(['preview','apply']),period:z.string().regex(/^\d{4}-\d{2}-[12]$/),files:z.array(z.object({name:z.string().min(1).max(200),data:z.string().min(1).max(1100000).regex(/^[A-Za-z0-9+/]*={0,2}$/)})).min(1).max(10),revision:z.string().optional(),choices:z.array(z.object({key:z.string(),employeeId:z.string().nullable(),outsideCRM:z.boolean().optional()})).max(500).optional()});
export const POST=authenticated(async req=>{
 try{
  const d=db(),actor=new URL(req.url).searchParams.get('actorId')||'';
  const staff=await d.prepare('SELECT data FROM employees WHERE id=?').bind(actor).first<{data:string}>();
  if(!staff||JSON.parse(staff.data).role!=='admin')return Response.json({error:'Загрузка доступна только администратору'},{status:403});
  const body=schema.parse(await req.json());const documents=[];
  for(const file of body.files)documents.push(await readOfficialPdf(file.name,file.data));
  if(documents.reduce((n,d)=>n+d.rows.length,0)>500)throw Error('Не более 500 строк за одну загрузку');
  const result=body.action==='preview'?await officialPreview(d,body.period,documents):await applyOfficialImport(d,actor,body.period,documents,body.revision||'',body.choices||[]);
  return Response.json(result);
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Проверьте выбранные PDF':e instanceof Error?e.message:'Не удалось прочитать PDF'},{status:400});}
});
