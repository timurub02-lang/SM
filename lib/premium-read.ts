import type {db} from './db';
import type {Employee,Order} from './crm';
import {ledgerKey,type PremiumLedger} from './premium-ledger';
import type {PremiumSaved} from './premium-calculation';
export async function readPremiumStateFrom(d:ReturnType<typeof db>,period:string){
 const [staff,orders,drafts,stored]=await Promise.all([
  d.prepare('SELECT id,data,version FROM employees ORDER BY id').all<{id:string;data:string;version:number}>(),
  d.prepare('SELECT id,data,version FROM orders ORDER BY id').all<{id:string;data:string;version:number}>(),
  d.prepare('SELECT id,data FROM settings WHERE id LIKE ? ORDER BY id').bind('premium-draft:'+period+':%').all<{id:string;data:string}>(),
  d.prepare('SELECT data FROM settings WHERE id=?').bind(ledgerKey).first<{data:string}>()
 ]);
 return {employees:staff.results.map(r=>({...JSON.parse(r.data),version:r.version}) as Employee),orders:orders.results.map(r=>({...JSON.parse(r.data),version:r.version}) as Order),adjustments:Object.fromEntries(drafts.results.map(r=>[r.id.slice(('premium-draft:'+period+':').length),JSON.parse(r.data)])) as Record<string,PremiumSaved>,ledger:stored?JSON.parse(stored.data) as PremiumLedger:null,raw:stored?.data||'',staffVersions:JSON.stringify(staff.results.map(r=>[r.id,r.version])),orderVersions:JSON.stringify(orders.results.map(r=>[r.id,r.version])),draftVersions:JSON.stringify(drafts.results.map(r=>[r.id,r.data]))};
}
