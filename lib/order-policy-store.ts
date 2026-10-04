import {db} from './db';
import {defaultOrderPolicy,orderPolicySchema,type OrderPolicy} from './order-policy';
export async function orderSettings(){const row=await db().prepare("SELECT data FROM settings WHERE id='order-policy'").first<{data:string}>();const saved=row?JSON.parse(row.data) as {policy:OrderPolicy;revision:string}:{policy:defaultOrderPolicy,revision:''};return {...saved,policy:orderPolicySchema.parse(saved.policy)};}
