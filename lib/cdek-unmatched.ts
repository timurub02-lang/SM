import type {ActivityDb as Db} from './activity-store.ts';
import type {CdekRemittance} from './cdek-remittance.ts';
export async function initCdekUnmatched(d:Db){
 await d.prepare('CREATE TABLE IF NOT EXISTS cdek_unmatched_remittances (receipt TEXT PRIMARY KEY,slot INTEGER NOT NULL,tracking TEXT NOT NULL,payment_date TEXT NOT NULL,first_seen TEXT NOT NULL)').run();
 await d.prepare('CREATE INDEX IF NOT EXISTS cdek_unmatched_tracking ON cdek_unmatched_remittances(slot,tracking)').run();
}
export async function saveCdekUnmatched(d:Db,receipts:CdekRemittance[],at:string){
 for(const r of receipts)await d.prepare('INSERT OR IGNORE INTO cdek_unmatched_remittances(receipt,slot,tracking,payment_date,first_seen) VALUES(?,?,?,?,?)').bind(JSON.stringify(r),r.slot,r.tracking,r.paymentDate,at).run();
}
export async function resolveCdekUnmatched(d:Db,receipts:CdekRemittance[]){
 for(const receipt of receipts)await d.prepare('DELETE FROM cdek_unmatched_remittances WHERE receipt=?').bind(JSON.stringify(receipt)).run();
}
