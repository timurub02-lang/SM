import {createHash,randomUUID} from 'node:crypto';
import type {ActivityDb} from './activity-store.ts';
import type {Employee} from './crm.ts';
import {defaultPremiumAdjustment,type PremiumSaved} from './premium-calculation.ts';
import {departmentSigned,type PremiumLedger} from './premium-ledger.ts';
import {normalizeOfficialName,type OfficialDocument} from './premium-pdf.ts';
const staffSql="SELECT json_group_array(json_array(id,data,version)) value FROM (SELECT id,data,version FROM employees ORDER BY id)";
const draftsSql="SELECT json_group_array(json_array(id,data)) value FROM (SELECT id,data FROM settings WHERE id LIKE ? ORDER BY id)";
export async function officialState(d:ActivityDb,period:string){
 const outsideRaw=(await d.prepare("SELECT data FROM settings WHERE id='premium-official-outside-crm'").first())?.data as string|undefined;
 const outside:Record<string,boolean>=outsideRaw?JSON.parse(outsideRaw):{};
 const staffRaw=(await d.prepare(staffSql).first()).value as string;
 const draftRaw=(await d.prepare(draftsSql).bind('premium-draft:'+period+':%').first()).value as string;
 const ledgerRaw=(await d.prepare("SELECT data FROM settings WHERE id='premium-ledger'").first())?.data as string|undefined;
 const ledger:PremiumLedger|undefined=ledgerRaw?JSON.parse(ledgerRaw):undefined,entry=ledger?.periods[period];
 if(!entry||ledger?.activePeriod!==period||entry.status==='paid')throw Error('Импорт доступен только в текущий невыплаченный период');
 const staff:Employee[]=JSON.parse(staffRaw).map(([id,data,version]:[string,string,number])=>({...JSON.parse(data),id,version}));
 const drafts:Record<string,PremiumSaved>=Object.fromEntries(JSON.parse(draftRaw).map(([id,data]:[string,string])=>[id.slice(('premium-draft:'+period+':').length),JSON.parse(data)]));
 const candidates=staff.filter(e=>e.role==='operator'||e.role==='department_head'&&e.leaderPremium).map(e=>{
  const row=entry.rows?.find(r=>r.employeeId===e.id),input=drafts[e.id]||row?.input||defaultPremiumAdjustment(e);
  return {id:e.id,name:e.name,alias:e.alias||'',login:e.login,department:row?.department||e.department||'',official:input.official,blocked:departmentSigned(entry,row?.department||e.department||''),input};
 });
 return {outside,outsideRaw,staffRaw,draftRaw,ledgerRaw:ledgerRaw!,candidates,revision:createHash('sha256').update(JSON.stringify([period,staffRaw,draftRaw,ledgerRaw,outsideRaw])).digest('hex')};
}
const documentKey=(period:string,hash:string)=>'premium-official-pdf:'+period+':'+hash;
export async function officialPreview(d:ActivityDb,period:string,documents:OfficialDocument[]){
 const state=await officialState(d,period);
 if(new Set(documents.map(v=>v.hash)).size!==documents.length)throw Error('Один PDF выбран дважды');
 for(const doc of documents)if(await d.prepare('SELECT id FROM settings WHERE id=?').bind(documentKey(period,doc.hash)).first())throw Error(doc.name+': этот PDF уже внесён в выбранный период');
 return {revision:state.revision,candidates:state.candidates.map(({input,...r})=>r),documents,rows:documents.flatMap(doc=>doc.rows.map(row=>{
  const matches=state.candidates.filter(e=>normalizeOfficialName(e.name)===normalizeOfficialName(row.name)||!!e.alias&&normalizeOfficialName(e.alias)===normalizeOfficialName(row.name));
  return {...row,file:doc.name,outsideCRM:!!state.outside[normalizeOfficialName(row.name)],employeeId:matches.length===1&&!matches[0].blocked?matches[0].id:null};
 }))};
}
export async function applyOfficialImport(d:ActivityDb,actor:string,period:string,documents:OfficialDocument[],revision:string,choices:{key:string;employeeId:string|null;outsideCRM?:boolean}[]){
 const preview=await officialPreview(d,period,documents),state=await officialState(d,period);
 if(preview.revision!==revision||state.revision!==revision)throw Error('Расчёт или сотрудники изменились. Загрузите PDF заново и проверьте сверку');
 if(choices.length!==preview.rows.length||new Set(choices.map(c=>c.key)).size!==choices.length)throw Error('Подтвердите каждую строку PDF');
 const used=new Set<string>();const changes=preview.rows.flatMap(row=>{
  const choice=choices.find(c=>c.key===row.key);if(!choice)throw Error('Не выбрано соответствие');if(choice.outsideCRM&&choice.employeeId!==null)throw Error('Проверьте исключённую строку');if(choice.employeeId===null)return [];
  const target=state.candidates.find(e=>e.id===choice.employeeId);if(!target||target.blocked)throw Error('Сотрудник недоступен или отдел подписан');
  if(used.has(target.id))throw Error('Один сотрудник выбран в нескольких строках. Проверьте сопоставление');used.add(target.id);
  return [{employeeId:target.id,name:row.name,file:row.file,before:target.official,amount:row.amount/100,input:target.input}];
 });
 const outside={...state.outside};
 for(const row of preview.rows){const choice=choices.find(c=>c.key===row.key)!;if(choice.outsideCRM)outside[normalizeOfficialName(row.name)]=true;else delete outside[normalizeOfficialName(row.name)];}
 if(!changes.length&&!choices.some(c=>c.outsideCRM)&&JSON.stringify(outside)===JSON.stringify(state.outside))throw Error('Нет изменений для записи');
 const id='premium-official-import:'+randomUUID(),at=new Date().toISOString();
 const audit=JSON.stringify({actor,period,at,documents:documents.map(({rows,...doc})=>doc),choices,changes:changes.map(({input,...r})=>r)});
 const guard=`COALESCE((SELECT data FROM settings WHERE id='premium-official-outside-crm'),'')=? AND (${staffSql})=? AND (${draftsSql})=? AND EXISTS(SELECT 1 FROM settings WHERE id='premium-ledger' AND data=?) AND NOT EXISTS(SELECT 1 FROM settings WHERE id IN (SELECT value FROM json_each(?)))`;
 const marker=d.prepare('INSERT INTO settings(id,data) SELECT ?,? WHERE '+guard).bind(id,audit,state.outsideRaw||'',state.staffRaw,'premium-draft:'+period+':%',state.draftRaw,state.ledgerRaw,JSON.stringify(documents.map(doc=>documentKey(period,doc.hash))));
 const writes=changes.map(c=>d.prepare('INSERT INTO settings(id,data) SELECT ?,? WHERE EXISTS(SELECT 1 FROM settings WHERE id=? AND data=?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind('premium-draft:'+period+':'+c.employeeId,JSON.stringify({...c.input,official:c.amount,revision:randomUUID(),updatedAt:at,updatedBy:actor,officialImport:id}),id,audit));
 const receipts=documents.map(doc=>d.prepare('INSERT INTO settings(id,data) SELECT ?,? WHERE EXISTS(SELECT 1 FROM settings WHERE id=? AND data=?)').bind(documentKey(period,doc.hash),JSON.stringify({import:id,name:doc.name,at,actor}),id,audit));
 const exclusions=d.prepare("INSERT INTO settings(id,data) SELECT 'premium-official-outside-crm',? WHERE EXISTS(SELECT 1 FROM settings WHERE id=? AND data=?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify(outside),id,audit);
 const results=await d.batch([marker,...writes,...receipts,exclusions]);
 if(!results[0].meta.changes)throw Error('Данные изменились во время подтверждения. Загрузите PDF заново');
 return {updated:changes.length,total:changes.reduce((sum,c)=>sum+Math.round(c.amount*100),0)/100};
}
