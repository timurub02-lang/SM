import type {Workbook} from 'exceljs';
import {normalizedPhone} from './base-distribution.ts';
import type {ImportRow} from './base-import.ts';

export function readImportWorkbook(book:Workbook){
 const links=new Map<string,Set<string>>();const sheet=book.getWorksheet('Связанные номера');if(sheet?.state==='visible')sheet.eachRow((row,n)=>{if(n===1)return;const a=normalizedPhone(row.getCell(1).text),b=normalizedPhone(row.getCell(2).text);if(!a||!b)return;const group=new Set([a,b,...links.get(a)||[],...links.get(b)||[]]);for(const phone of group)links.set(phone,group);});
 const output:ImportRow[]=[],seen=new Set<string>();let duplicates=0;
 book.eachSheet(sh=>{if(sh.state!=='visible'||sh.name==='Связанные номера')return;const headers:string[]=[];sh.getRow(1).eachCell((cell,col)=>{headers[col]=cell.text.trim();});const phone=headers.findIndex(h=>['телефон','номер телефона','phone','мобильный телефон'].includes(h?.toLowerCase())),name=headers.findIndex(h=>['фио','имя','клиент','name','фио клиента'].includes(h?.toLowerCase()));if(phone<1&&sh.rowCount>1)throw Error(`На листе «${sh.name}» нет столбца «Телефон» в первой строке`);
 const city=headers.findIndex(h=>h?.toLowerCase()==='город'),extra=headers.findIndex(h=>['доп номер','доп. номер','дополнительный телефон','дополнительный номер'].includes(h?.toLowerCase()));
 sh.eachRow((row,n)=>{if(n===1)return;const raw=row.getCell(phone).text,normalized=normalizedPhone(raw),extraRaw=extra>0?row.getCell(extra).text.trim():'';
 const extras=extraRaw?extraRaw.split(/[,;\n]+/).map(p=>normalizedPhone(p)):[];
 if(extras.some(p=>!p))throw Error(`На листе «${sh.name}», строка ${n}: проверьте дополнительный телефон`);
 const linked=[...new Set([...links.get(normalized)||[],...extras])].filter(p=>p!==normalized);
 // Keep linked rows for server-side reconciliation: dropping them here can hide a second existing client.
 if(normalized&&seen.has(normalized)&&!linked.length){duplicates++;return;}if(normalized)seen.add(normalized);
 output.push({row:n,phone:raw,name:name>0?row.getCell(name).text:'',city:city>0?row.getCell(city).text:'',linkedPhones:linked});});});
 return {output,duplicates};
}
