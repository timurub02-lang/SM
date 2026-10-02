import {db} from './db';
import {defaultOrderPolicy,type OrderPolicy} from './order-policy';
export async function orderSettings(){const row=await db().prepare("SELECT data FROM settings WHERE id='order-policy'").first<{data:string}>();return row?JSON.parse(row.data) as {policy:OrderPolicy;revision:string}:{policy:defaultOrderPolicy,revision:''};}
