import {db} from '@/lib/db';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {z} from 'zod';
const phone=z.string().trim().max(30).refine(v=>!v||(/^[+\d\s()-]+$/.test(v)&&v.replace(/\D/g,'').length>=10),'Проверьте номер телефона');
const schema=z.object({actorId:z.string().min(1),phones:z.tuple([phone,phone]),departments:z.object({'1':z.enum(['','1','2']),'2':z.enum(['','1','2']),'3':z.enum(['','1','2'])}),revision:z.string()}).refine(p=>Object.values(p.departments).every(n=>!n||p.phones[Number(n)-1]),'Заполните назначенный отделу номер');
export async function GET(){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 const row=await db().prepare("SELECT data FROM settings WHERE id='callback-phones'").first<{data:string}>();
 return Response.json(row?JSON.parse(row.data):{phones:['',''],departments:{'1':'','2':'','3':''},revision:''},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Запрос отклонён'},{status:403});
 try{
 const raw=await req.text();if(raw.length>3000)throw Error();
 const p=schema.parse(JSON.parse(raw));
 const actor=await db().prepare('SELECT data FROM employees WHERE id=?').bind(p.actorId).first<{data:string}>();
 if(!actor||JSON.parse(actor.data).role!=='admin')return Response.json({error:'Настройка доступна администратору'},{status:403});
 const data={phones:p.phones,departments:p.departments,revision:crypto.randomUUID()};
 const result=await db().prepare("INSERT INTO settings(id,data) SELECT 'callback-phones',? WHERE ?='' OR EXISTS(SELECT 1 FROM settings WHERE id='callback-phones') ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE json_extract(settings.data,'$.revision')=?").bind(JSON.stringify(data),p.revision,p.revision).run();
 if(!result.meta.changes)return Response.json({error:'Настройки изменены в другом окне. Закройте и откройте настройки снова.'},{status:409});
 return Response.json(data);
 }catch{return Response.json({error:'Проверьте номера телефонов и их назначение отделам.'},{status:400});}
}
