import {z} from 'zod';
import type {ActivityDb} from './activity-store.ts';
import type {Employee} from './crm.ts';

export const canEditProductCost=(role:Employee['role'])=>role==='admin'||role==='purchasing';
export const productCostSchema=z.object({amount:z.number().finite().min(0).max(100000000).multipleOf(.01).nullable(),revision:z.string().max(100)});
const storedCostSchema=productCostSchema.extend({aliases:z.array(z.string().trim().min(1).max(255)).max(100).optional()});
export type ProductCost=z.infer<typeof productCostSchema>;
export const productCostKey=(id:string)=>'warehouse-cost:'+id;
export const costName=(name:string)=>name.trim().toLocaleLowerCase('ru');
export const productCostsQuery="SELECT p.id,json_extract(p.data,'$.name') AS name,c.data FROM products p LEFT JOIN settings c ON c.id='warehouse-cost:'||p.id ORDER BY p.id";
export const productCostsGuard='(SELECT json_group_array(json_array(id,name,data)) FROM ('+productCostsQuery+'))=?';
export async function readProductCosts(d:ActivityDb){
 const rows:{id:string;name:string;data:string|null}[]=(await d.prepare(productCostsQuery).all()).results;
 const saved=Object.fromEntries(rows.map(r=>[r.id,r.data?storedCostSchema.parse(JSON.parse(r.data)):{amount:null,revision:''}]));
 const names=new Map<string,{id:string;amount:number|null}>();
 for(const r of rows)for(const name of [r.name,...saved[r.id].aliases||[]]){
  const key=costName(name),previous=names.get(key);
  if(previous&&previous.id!==r.id)throw Error('Несколько складских товаров соответствуют одному названию');
  names.set(key,{id:r.id,amount:saved[r.id].amount});
 }
 const costs=Object.fromEntries(rows.map(r=>[r.id,{amount:saved[r.id].amount,revision:saved[r.id].revision}]));
 return {costs,prices:Object.fromEntries([...names].map(([name,cost])=>[name,cost.amount])),revision:JSON.stringify(rows.map(r=>[r.id,r.name,r.data]))};
}
