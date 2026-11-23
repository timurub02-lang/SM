import {nameBase} from './name-base.ts';
import {normalizedPhone} from './base-distribution.ts';
export type ImportRow={row:number;phone:string;name:string;city?:string;linkedPhones?:string[];fields?:Record<string,string>};
export type ExistingClient={id:string;phone:string;linkedPhones?:string[];baseType?:'M'|'J';sheet?:string;owner?:string;version:number;[key:string]:unknown};
export function planImport(rows:ImportRow[],existing:ExistingClient[],base:'M'|'J',target:string,choices:Record<string,'M'|'J'>={},autoTargets?:Record<'M'|'J',string>,deduplicate=true){
 const byPhone=new Map<string,ExistingClient[]>();for(const c of existing)for(const raw of [c.phone,...c.linkedPhones||[]]){const n=normalizedPhone(raw);if(n)byPhone.set(n,[...byPhone.get(n)||[],c]);}
 const seen=new Set<string>();
 const previewRows:{identities:string[];kind:'added'|'skipped'|'review';phone:string;destination?:'M'|'J'}[]=[];
 const result={previewRows,review:[] as {key:string;row:number;phone:string;name:string}[],added:[] as (ImportRow&{destination?:'M'|'J';target?:string})[],matched:[] as {client:ExistingClient;row:ImportRow}[],moved:[] as {client:ExistingClient;sheet:string;baseType:'M'|'J'}[],skipped:0,duplicates:0,invalid:[] as {row:number;phone:string;reason:string}[],conflicts:[] as {phone:string;clientId:string;name:string;baseType:string}[]};
 for(const row of rows){const phone=normalizedPhone(row.phone);if(!phone){result.invalid.push({row:row.row,phone:row.phone,reason:row.phone?'Некорректный российский телефон':'Пустой телефон'});continue;}
 const phones=[...new Set([phone,...(row.linkedPhones||[]).map(normalizedPhone).filter(Boolean)])];
 const matches=[...new Map(phones.flatMap(n=>byPhone.get(n)||[]).map(c=>[c.id,c])).values()];
 // A link joining two existing records needs explicit reconciliation, never silently merge order histories.
 if(matches.length>1){result.invalid.push({row:row.row,phone:row.phone,reason:'Связанные номера указывают на разных существующих клиентов; требуется объединение'});continue;}
 const c=matches[0],identities=c?[...phones,'id:'+c.id]:phones;
 if(deduplicate&&identities.some(n=>seen.has(n))){result.duplicates++;continue;}identities.forEach(n=>seen.add(n));
 if(c){previewRows.push({identities,kind:'skipped',phone});result.matched.push({client:c,row});result.skipped++;continue;}
 else {
 const destination=autoTargets?(choices['new:'+phone]||nameBase(row.name)):base;
 if(!destination){previewRows.push({identities,kind:'review',phone});result.review.push({key:'new:'+phone,row:row.row,phone,name:row.name});continue;}
 previewRows.push({identities,kind:'added',phone,destination});
 result.added.push({...row,phone,linkedPhones:phones.filter(n=>n!==phone),...(autoTargets?{destination,target:autoTargets[destination]}:{})});
 }
 }
 return result;
}
