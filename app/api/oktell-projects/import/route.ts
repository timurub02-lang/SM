import {z} from 'zod';
import ExcelJS from 'exceljs';
import {sessionEmployee,trustedOrigin} from '@/lib/auth';
import {db} from '@/lib/db';
import {importOptions,importError,importProjectWorkbook,projectImportInventory,uploadLimit} from '@/lib/oktell-project-import';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function actor(req:Request){const a=await sessionEmployee(req.headers);return a?.role==='admin'&&!a.impersonation?a:null;}
function failure(e:unknown){
 if(e instanceof z.ZodError)return json({error:'Проверьте проект и выбранные столбцы.'},400);
 if(e instanceof Error&&'status' in e)return json({error:e.message},Number(e.status));
 return json({error:'Не удалось обработать файл. Повторите проверку; повторная загрузка не создаст дубли.'},500);
}
export async function GET(req:Request){
 if(process.env.OKTELL_PROJECT_SETTINGS!=='1')return json({error:'Импорт проектов выключен.'},410);
 if(!await actor(req))return json({error:'Импорт доступен только администратору.'},403);
 try{
  const q=new URL(req.url).searchParams;
  if(q.get('template')==='1'){
   const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Контакты');
   sheet.columns=[{header:'Телефон',key:'phone',width:22},{header:'Имя',key:'name',width:35},{header:'Город',key:'city',width:25}];
   sheet.getColumn(1).numFmt='@';sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];
   return new Response(new Uint8Array(await book.xlsx.writeBuffer()),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="oktell-contacts.xlsx"','Cache-Control':'no-store'}});
  }
  return json(await projectImportInventory(db(),z.string().uuid().parse(q.get('projectId'))));
 }catch(e){return failure(e);}
}
let processing=false;
export async function POST(req:Request){
 if(process.env.OKTELL_PROJECT_SETTINGS!=='1')return json({error:'Импорт проектов выключен.'},410);
 const user=await actor(req);if(!user||!trustedOrigin(req.headers))return json({error:'Нет доступа.'},403);
 if(processing)return json({error:'Другой Excel-файл сейчас обрабатывается. Повторите через несколько секунд.'},429);
 processing=true;
 try{
  const q=new URL(req.url).searchParams,action=q.get('action');
  if(action!=='preview'&&action!=='confirm')throw importError('Неизвестная операция импорта.');
  const opts=importOptions.parse(Object.fromEntries(['projectId','sheet','phone','name','city'].filter(k=>q.has(k)).map(k=>[k,q.get(k)])));
  const token=action==='confirm'?z.string().regex(/^[a-f0-9]{64}$/).parse(q.get('token')):undefined;
  if(Number(req.headers.get('content-length'))>uploadLimit)throw importError('Файл больше 5 МБ.',413);
  if(!req.body)throw importError('Выберите Excel-файл.');
  const reader=req.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>uploadLimit){await reader.cancel();throw importError('Файл больше 5 МБ.',413);}chunks.push(value);}}finally{reader.releaseLock();}
  return json(await importProjectWorkbook(db(),user.id,Buffer.concat(chunks),opts,q.get('filename')||'',token));
 }catch(e){return failure(e);}finally{processing=false;}
}
