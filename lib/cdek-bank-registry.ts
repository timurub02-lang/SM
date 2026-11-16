import {z} from 'zod';
import type {ActivityDb} from './activity-store.ts';

export const registryDay=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s);
const number=z.union([z.string().trim().min(1).max(100),z.number().int().nonnegative().safe()]).transform(String);
const amount=z.number().finite().min(-1e9).max(1e9);
export const registryResponse=z.object({errors:z.array(z.unknown()).optional(),warnings:z.array(z.unknown()).optional(),registries:z.array(z.object({registry_number:number,payment_date:registryDay.optional(),orders:z.array(z.object({cdek_number:number,transfer_sum:amount,payment_sum:amount,basis_type:z.string().optional()}))})).optional()}).strict();
export type BankRegistry={slot:number;registry:string;date:string;receivedAt:string;rows:{tracking:string;basis:string;collected:number;transferred:number}[]};
export const bankRegistryKey=(r:Pick<BankRegistry,'slot'|'registry'|'date'>)=>JSON.stringify([r.slot,r.registry,r.date]);
export const bankRegistryPrefix='cdek-bank-registry:';

export function bankRegistries(data:unknown,slot:number,at:string):BankRegistry[]{
 const parsed=registryResponse.parse(data);if(parsed.errors?.length)throw Error('СДЭК не подтвердил получение реестров');
 if(!Number.isInteger(slot)||slot<1||slot>4||!Number.isFinite(Date.parse(at)))throw Error('Некорректный аккаунт или время получения реестра');
 const result=new Map<string,BankRegistry>();
 for(const r of parsed.registries||[]){
  if(!r.payment_date){if(r.orders.some(o=>o.transfer_sum||o.payment_sum))throw Error('В реестре отсутствует дата перечисления');continue;}
  const row:BankRegistry={slot,registry:r.registry_number,date:r.payment_date,receivedAt:at,rows:r.orders.map(o=>({tracking:o.cdek_number,basis:o.basis_type||'ORDER',collected:Math.round(o.payment_sum*100),transferred:Math.round(o.transfer_sum*100)})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};
  if(!Number.isSafeInteger(row.rows.reduce((s,o)=>s+o.collected,0))||!Number.isSafeInteger(row.rows.reduce((s,o)=>s+o.transferred,0)))throw Error('Сумма реестра превышает допустимую');
  const key=bankRegistryKey(row),previous=result.get(key);
  if(previous&&JSON.stringify(previous.rows)!==JSON.stringify(row.rows))throw Error('СДЭК вернул разные версии одного реестра');
  result.set(key,row);
 }
 return [...result.values()];
}

export async function saveBankRegistries(d:ActivityDb,registries:BankRegistry[]){
 for(const r of registries){
  const id=bankRegistryPrefix+bankRegistryKey(r);const old:{data:string}|null=await d.prepare('SELECT data FROM settings WHERE id=?').bind(id).first();
  const data=JSON.stringify({...r,receivedAt:old?JSON.parse(old.data).receivedAt:r.receivedAt});
  if(old?.data===data)continue;
  const changed=old?await d.prepare('UPDATE settings SET data=? WHERE id=? AND data=?').bind(data,id,old.data).run():await d.prepare('INSERT OR IGNORE INTO settings(id,data) VALUES(?,?)').bind(id,data).run();
  if(!changed.meta.changes)throw Error('Реестр изменился во время загрузки; требуется повтор');
 }
}

export async function readBankRegistries(d:ActivityDb){
 const rows:{id:string;data:string}[]=(await d.prepare("SELECT id,data FROM settings WHERE id LIKE 'cdek-bank-registry:%' ORDER BY id").all()).results;
 return {registries:rows.map(r=>JSON.parse(r.data) as BankRegistry),revision:JSON.stringify(rows.map(r=>[r.id,r.data]))};
}
