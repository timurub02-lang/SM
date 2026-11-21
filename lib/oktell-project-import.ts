import {createHash,randomUUID} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {z} from 'zod';
import ExcelJS from 'exceljs';
import {normalizedPhone} from './base-distribution.ts';

type Database={prepare:(sql:string)=>any;batch:(statements:any[])=>Promise<any[]>};
export const importError=(message:string,status=400)=>Object.assign(Error(message),{status});
export const uploadLimit=5*1024*1024;
const rowLimit=50000;
export const importOptions=z.object({projectId:z.string().uuid(),sheet:z.coerce.number().int().min(1).max(20).optional(),phone:z.coerce.number().int().min(1).max(100).optional(),name:z.coerce.number().int().min(0).max(100).default(0),city:z.coerce.number().int().min(0).max(100).default(0)}).strict();
export type ImportOptions=z.infer<typeof importOptions>;
export type ImportContact={row:number;phone:string;name:string;city:string};
export type ImportPreview={token:string;receiptId:string;options:ImportOptions;sheets:{id:number;name:string}[];columns:{id:number;name:string}[];total:number;added:number;duplicates:number;invalid:number;empty:number;sample:ImportContact[];errors:{row:number;reason:string}[]};
export type ImportReceipt={id:string;filename:string;added:number;duplicates:number;invalid:number;at:string};
export type ImportInventory={total:number;contacts:ImportContact[];imports:ImportReceipt[]};

// Bound actual inflation before ExcelJS builds a workbook. ZIP64/encrypted archives are not accepted.
export function validateWorkbookZip(b:Buffer){
 if(b.length>uploadLimit)throw importError('Выберите .xlsx размером до 5 МБ.',413);
 try{
  let end=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50&&i+22+b.readUInt16LE(i+20)===b.length){end=i;break;}
  if(end<0||b.readUInt32LE(end+4)!==0)throw Error();
  const count=b.readUInt16LE(end+10),size=b.readUInt32LE(end+12);let pos=b.readUInt32LE(end+16),total=0;
  if(count<1||count>2000||pos+size!==end||b.readUInt16LE(end+8)!==count)throw Error();
  const names=new Set<string>();
  for(let i=0;i<count;i++){
   if(b.readUInt32LE(pos)!==0x02014b50)throw Error();
   const flags=b.readUInt16LE(pos+8),method=b.readUInt16LE(pos+10),compressed=b.readUInt32LE(pos+20),expanded=b.readUInt32LE(pos+24),n=b.readUInt16LE(pos+28),extra=b.readUInt16LE(pos+30),comment=b.readUInt16LE(pos+32),offset=b.readUInt32LE(pos+42);
   const name=b.subarray(pos+46,pos+46+n).toString('utf8');
   if(flags&1||![0,8].includes(method)||names.has(name)||name.startsWith('/')||name.split('/').includes('..')||expanded>32*1024*1024||offset>=pos)throw Error();
   names.add(name);total+=expanded;if(total>32*1024*1024)throw Error();
   if(b.readUInt32LE(offset)!==0x04034b50||b.readUInt16LE(offset+8)!==method||b.readUInt16LE(offset+6)!==flags)throw Error();
   const localName=b.readUInt16LE(offset+26),start=offset+30+localName+b.readUInt16LE(offset+28);
   if(b.subarray(offset+30,offset+30+localName).toString('utf8')!==name||start+compressed>pos)throw Error();
   const raw=b.subarray(start,start+compressed),inflated=method===0?raw:inflateRawSync(raw,{maxOutputLength:Math.max(1,expanded)});
   if(inflated.length!==expanded)throw Error();
   if(/^xl\/worksheets\/sheet[^/]*\.xml$/.test(name)){
    const xml=inflated.toString('utf8');
    for(const match of xml.matchAll(/<row\b[^>]*\br=["'](\d+)["']/g))if(Number(match[1])>rowLimit+1)throw Error();
    for(const match of xml.matchAll(/<c\b[^>]*\br=["']([A-Z]+)(\d+)["']/g)){
     let col=0;for(const char of match[1])col=col*26+char.charCodeAt(0)-64;
     if(col>100||Number(match[2])>rowLimit+1)throw Error();
    }
   }

   pos+=46+n+extra+comment;
  }
  if(pos!==end||!names.has('xl/workbook.xml')||!names.has('[Content_Types].xml')||[...names].some(n=>/vbaProject|externalLinks/i.test(n)))throw Error();
 }catch{throw importError('Файл повреждён, защищён или слишком сложный. Сохраните таблицу без макросов как .xlsx.');}
}
function cellText(cell:ExcelJS.Cell){
 const value=cell.value;
 if(value===null||value===undefined)return '';
 if(typeof value==='string'||typeof value==='number')return String(value).trim();
 if(typeof value==='object'&&'richText' in value)return value.richText.map(p=>p.text).join('').trim();
 throw Error('Используйте текст или число вместо формулы, даты или ссылки.');
}
export async function parseProjectWorkbook(bytes:Buffer,raw:unknown){
 const options=importOptions.parse(raw);validateWorkbookZip(bytes);
 const book=new ExcelJS.Workbook();
 try{await book.xlsx.load(bytes as any,{ignoreNodes:['mergeCells','dataValidations','drawing','picture','conditionalFormatting','extLst']});}catch{throw importError('Не удалось прочитать Excel. Сохраните файл в формате .xlsx.');}
 const visible=book.worksheets.filter(s=>s.state==='visible');
 if(!visible.length||book.worksheets.length>20||book.worksheets.some(s=>s.rowCount>rowLimit+1||s.columnCount>100))throw importError('В файле допустимо до 20 видимых листов, 50 000 строк и 100 столбцов на лист.');
 const sheet=options.sheet?visible.find(s=>s.id===options.sheet):visible[0];if(!sheet)throw importError('Выбранный лист не найден.');
 const columns=Array.from({length:sheet.columnCount},(_,i)=>{let label='';try{label=cellText(sheet.getRow(1).getCell(i+1)).slice(0,100);}catch{}return {id:i+1,name:label||`Столбец ${i+1}`};});
 const guess=(names:string[])=>columns.find(c=>names.includes(c.name.toLowerCase()))?.id||0;
 const mapped={...options,sheet:sheet.id,phone:options.phone||guess(['телефон','номер телефона','phone','мобильный телефон']),name:options.phone?options.name:guess(['фио','имя','name','клиент']),city:options.phone?options.city:guess(['город','city'])};
 const selected=[mapped.phone,mapped.name,mapped.city].filter(Boolean);
 if(new Set(selected).size!==selected.length||selected.some(c=>c>sheet.columnCount))throw importError('Выберите разные существующие столбцы для телефона, имени и города.');
 const contacts:ImportContact[]=[],errors:{row:number;reason:string}[]=[];const seen=new Set<string>();let total=0,invalid=0,duplicates=0,empty=0;
 if(mapped.phone)sheet.eachRow((row,index)=>{
  if(index===1)return;total++;
  try{
   let phone=cellText(row.getCell(mapped.phone));const name=mapped.name?cellText(row.getCell(mapped.name)):'',city=mapped.city?cellText(row.getCell(mapped.city)):'';
   if(!phone&&!name&&!city){empty++;return;}
   if(/^\d{10}$/.test(phone))phone='7'+phone;phone=normalizedPhone(phone);
   if(!phone)throw Error('Нет корректного телефона: нужны 10 цифр или 11 цифр с 7/8.');
   if(name.length>200||city.length>200)throw Error('Имя и город должны быть не длиннее 200 символов.');
   if(seen.has(phone)){duplicates++;return;}seen.add(phone);contacts.push({row:index,phone,name,city});
  }catch(e){invalid++;if(errors.length<100)errors.push({row:index,reason:(e as Error).message});}
 });
 return {options:mapped,sheets:visible.map(s=>({id:s.id,name:s.name})),columns,contacts,total,invalid,duplicates,empty,errors,fileHash:createHash('sha256').update(bytes).digest('hex')};
}
async function init(d:Database,projectId:string){
 if(!await d.prepare('SELECT id FROM oktell_project_drafts WHERE id=?').bind(projectId).first())throw importError('Сначала сохраните проект.',404);
 await d.batch([
  d.prepare('CREATE TABLE IF NOT EXISTS oktell_project_import_state(project_id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0,write_token TEXT)'),
  d.prepare('CREATE TABLE IF NOT EXISTS oktell_project_imports(project_id TEXT NOT NULL,id TEXT NOT NULL,filename TEXT NOT NULL,added INTEGER NOT NULL,duplicates INTEGER NOT NULL,invalid INTEGER NOT NULL,actor TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(project_id,id))'),
  d.prepare('CREATE TABLE IF NOT EXISTS oktell_project_contacts(project_id TEXT NOT NULL,phone TEXT NOT NULL,name TEXT NOT NULL,city TEXT NOT NULL,source_row INTEGER NOT NULL,import_id TEXT NOT NULL,PRIMARY KEY(project_id,phone))'),
  d.prepare('INSERT OR IGNORE INTO oktell_project_import_state(project_id) VALUES(?)').bind(projectId),
 ]);
}
export async function projectImportInventory(d:Database,projectId:string):Promise<ImportInventory>{
 await init(d,projectId);
 return {total:(await d.prepare('SELECT count(*) n FROM oktell_project_contacts WHERE project_id=?').bind(projectId).first()).n,
 contacts:(await d.prepare('SELECT phone,name,city,source_row AS row FROM oktell_project_contacts WHERE project_id=? ORDER BY phone LIMIT 50').bind(projectId).all()).results,
 imports:(await d.prepare('SELECT id,filename,added,duplicates,invalid,at FROM oktell_project_imports WHERE project_id=? ORDER BY at DESC LIMIT 20').bind(projectId).all()).results};
}
export async function importProjectWorkbook(d:Database,actor:string,bytes:Buffer,raw:unknown,filename:string,confirm?:string){
 const options=importOptions.parse(raw);await init(d,options.projectId);
 if(!/\.xlsx$/i.test(filename)||filename.length>200||/[\r\n\x00]/.test(filename))throw importError('Выберите файл .xlsx с именем до 200 символов.');
 const parsed=await parseProjectWorkbook(bytes,options),projectId=options.projectId;
 const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const receiptId=hash([projectId,parsed.fileHash,parsed.options.sheet,parsed.options.phone,parsed.options.name,parsed.options.city]);
 const previous=await d.prepare('SELECT id,filename,added,duplicates,invalid,at FROM oktell_project_imports WHERE project_id=? AND id=?').bind(projectId,receiptId).first();
 if(previous)return {applied:true,receipt:previous as ImportReceipt,replayed:true};
 const state=await d.prepare('SELECT revision FROM oktell_project_import_state WHERE project_id=?').bind(projectId).first();
 const existing=new Set<string>((await d.prepare('SELECT phone FROM oktell_project_contacts WHERE project_id=?').bind(projectId).all()).results.map((r:any)=>r.phone));
 const added=parsed.contacts.filter(c=>!existing.has(c.phone)),duplicates=parsed.duplicates+parsed.contacts.length-added.length;
 if(existing.size+added.length>100000)throw importError('В одном проекте допустимо до 100 000 контактов.');
 const token=hash([receiptId,state.revision,added.length,duplicates,parsed.invalid]);
 const preview:ImportPreview={token,receiptId,options:parsed.options,sheets:parsed.sheets,columns:parsed.columns,total:parsed.total,added:added.length,duplicates,invalid:parsed.invalid,empty:parsed.empty,sample:added.slice(0,10),errors:parsed.errors};
 if(confirm===undefined)return {applied:false,preview};
 if(!parsed.options.phone||!added.length)throw importError('В файле нет новых корректных контактов.');
 if(confirm!==token)throw importError('База или файл изменились. Выполните проверку файла заново.',409);
 const writeToken=randomUUID(),at=new Date().toISOString();
 await d.batch([
  d.prepare('UPDATE oktell_project_import_state SET revision=revision+1,write_token=? WHERE project_id=? AND revision=? AND NOT EXISTS(SELECT 1 FROM oktell_project_imports WHERE project_id=? AND id=?)').bind(writeToken,projectId,state.revision,projectId,receiptId),
  d.prepare('INSERT INTO oktell_project_imports SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM oktell_project_import_state WHERE project_id=? AND write_token=?)').bind(projectId,receiptId,filename,added.length,duplicates,parsed.invalid,actor,at,projectId,writeToken),
  d.prepare("INSERT INTO oktell_project_contacts SELECT ?,json_extract(value,'$.phone'),json_extract(value,'$.name'),json_extract(value,'$.city'),json_extract(value,'$.row'),? FROM json_each(?) WHERE EXISTS(SELECT 1 FROM oktell_project_import_state WHERE project_id=? AND write_token=?)").bind(projectId,receiptId,JSON.stringify(added),projectId,writeToken),
 ]);
 const receipt=await d.prepare('SELECT id,filename,added,duplicates,invalid,at FROM oktell_project_imports WHERE project_id=? AND id=?').bind(projectId,receiptId).first();
 if(!receipt)throw importError('Другой импорт изменил базу. Проверьте файл заново.',409);
 return {applied:true,receipt:receipt as ImportReceipt,replayed:false};
}
