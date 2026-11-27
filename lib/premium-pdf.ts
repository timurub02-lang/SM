import {createHash} from 'node:crypto';
export type OfficialDocument={name:string;hash:string;date:string;total:number;rows:{name:string;amount:number;key:string}[]};
export const normalizeOfficialName=(name:string)=>name.normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё','е').replace(/[^а-яa-z\s-]/g,'').replace(/\s+/g,' ').trim();
export function parseOfficialText(lines:string[],name:string,hash:string):OfficialDocument{
 const text=lines.join('\n');
 if(!/Список перечисляемой в банк зарплаты/i.test(text))throw Error(name+': не найдена зарплатная ведомость');
 const date=text.match(/от\s+(\d{2}\.\d{2}\.\d{4})/)?.[1];
 const money='(\\d[\\d \\u00a0]*,\\d{2})';
 const rows:OfficialDocument['rows']=[];let expected=1;
 for(const line of lines){
  const m=line.trim().match(new RegExp('^(\\d+)\\s+([А-ЯЁ][А-Яа-яЁё -]+?)\\s+'+money+'\\s*$'));
  if(!m)continue;
  if(Number(m[1])!==expected++)throw Error(name+': нарушен порядок строк, проверьте PDF');
  rows.push({name:m[2].trim(),amount:Math.round(Number(m[3].replace(/[ \u00a0]/g,'').replace(',','.'))*100),key:hash+':'+m[1]});
 }
 const totalMatch=text.match(new RegExp('(?:^|\\n)Итого\\s*\\n?\\s*'+money+'(?:\\s|$)'));
 const total=totalMatch?Math.round(Number(totalMatch[1].replace(/[ \u00a0]/g,'').replace(',','.'))*100):NaN;
 if(!date||!rows.length||!Number.isSafeInteger(total)||rows.reduce((n,r)=>n+r.amount,0)!==total)throw Error(name+': строки не сходятся с итогом PDF. Запись запрещена');
 return {name,hash,date,total,rows};
}
export async function readOfficialPdf(name:string,base64:string):Promise<OfficialDocument>{
 const bytes=Buffer.from(base64,'base64');
 if(bytes.length>800000||bytes.subarray(0,5).toString()!=='%PDF-')throw Error(name+': нужен PDF размером до 800 КБ');
 const hash=createHash('sha256').update(bytes).digest('hex');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:false,disableFontFace:true});
 try{
  const pdf=await task.promise;if(pdf.numPages>10)throw Error('В PDF должно быть не более 10 страниц');
  const lines:string[]=[];
  for(let i=1;i<=pdf.numPages;i++){
   const page=await pdf.getPage(i),content=await page.getTextContent();
   const items=content.items.filter((v):v is import('pdfjs-dist/types/src/display/api').TextItem=>'str' in v&&!!v.str.trim()).sort((a,b)=>b.transform[5]-a.transform[5]||a.transform[4]-b.transform[4]);
   const groups:{y:number;items:typeof items}[]=[];
   for(const item of items){let row=groups.find(r=>Math.abs(r.y-item.transform[5])<2);if(!row){row={y:item.transform[5],items:[]};groups.push(row);}row.items.push(item);}
   lines.push(...groups.map(r=>r.items.sort((a,b)=>a.transform[4]-b.transform[4]).map(v=>v.str).join(' ').trim()));
  }
  return parseOfficialText(lines,name,hash);
 }finally{await task.destroy();}
}
