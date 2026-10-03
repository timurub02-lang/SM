import {normalizedPhone} from './base-distribution.ts';
export type ImportRow={row:number;phone:string;name:string;linkedPhones?:string[];fields?:Record<string,string>};
export type ExistingClient={id:string;phone:string;linkedPhones?:string[];baseType?:'M'|'J';sheet?:string;owner?:string;version:number;[key:string]:unknown};
export function planImport(rows:ImportRow[],existing:ExistingClient[],base:'M'|'J',target:string,choices:Record<string,'M'|'J'>={}){
 const byPhone=new Map<string,ExistingClient[]>();for(const c of existing)for(const raw of [c.phone,...c.linkedPhones||[]]){const n=normalizedPhone(raw);if(n)byPhone.set(n,[...byPhone.get(n)||[],c]);}
 const seen=new Set<string>(),protectedSheets=new Set(['К','П','ЧС','ПВ',target]);
 const result={added:[] as ImportRow[],moved:[] as {client:ExistingClient;sheet:string;baseType:'M'|'J'}[],skipped:0,duplicates:0,invalid:[] as {row:number;phone:string;reason:string}[],conflicts:[] as {phone:string;clientId:string;name:string;baseType:string}[]};
 for(const row of rows){const phone=normalizedPhone(row.phone);if(!phone){result.invalid.push({row:row.row,phone:row.phone,reason:row.phone?'Некорректный российский телефон':'Пустой телефон'});continue;}
 const phones=[...new Set([phone,...(row.linkedPhones||[]).map(normalizedPhone).filter(Boolean)])];
 const matches=[...new Map(phones.flatMap(n=>byPhone.get(n)||[]).map(c=>[c.id,c])).values()];
 // A link joining two existing records needs explicit reconciliation, never silently merge order histories.
 if(matches.length>1){result.invalid.push({row:row.row,phone:row.phone,reason:'Связанные номера указывают на разных существующих клиентов; требуется объединение'});continue;}
 const c=matches[0],identities=c?[...phones,'id:'+c.id]:phones;
 if(identities.some(n=>seen.has(n))){result.duplicates++;continue;}identities.forEach(n=>seen.add(n));
 if(c){const current=c.baseType||'M';if(current!==base&&!choices[c.id]){result.conflicts.push({phone,clientId:c.id,name:String(c.name||''),baseType:current});continue;}
 const destination=choices[c.id]||base;
 if(destination!==base){result.skipped++;continue;}
 const sheet=c.owner?'К':String(c.sheet||'Т1');
 if(protectedSheets.has(sheet)){if(current!==base)result.moved.push({client:c,sheet,baseType:base});else result.skipped++;continue;}
 result.moved.push({client:c,sheet:target,baseType:base});
 }else result.added.push({...row,phone,linkedPhones:phones.filter(n=>n!==phone)});
 }
 return result;
}
