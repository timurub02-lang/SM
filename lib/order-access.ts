import {db} from './db';
import type {Employee} from './crm';

export async function initOrderAccess(){
 const d=db();
 await d.prepare('CREATE TABLE IF NOT EXISTS order_edit_leases(token TEXT PRIMARY KEY,order_id TEXT NOT NULL,employee_id TEXT NOT NULL,employee_name TEXT NOT NULL,expires_at INTEGER NOT NULL)').run();
 await d.prepare('CREATE INDEX IF NOT EXISTS order_edit_leases_order ON order_edit_leases(order_id,expires_at)').run();
}

// Separate leases keep another tab or an in-flight operation protected when a card closes.
export async function acquireOrderAccess(orderId:string,employee:Employee,token:string,leaseMs=120000){
 await initOrderAccess();const d=db(),now=Date.now();
 await d.prepare('DELETE FROM order_edit_leases WHERE expires_at<=?').bind(now).run();
 const result=await d.prepare(`INSERT INTO order_edit_leases(token,order_id,employee_id,employee_name,expires_at)
 SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM order_edit_leases WHERE order_id=? AND employee_id<>? AND expires_at>?)
 ON CONFLICT(token) DO UPDATE SET expires_at=excluded.expires_at,employee_name=excluded.employee_name
 WHERE order_edit_leases.order_id=excluded.order_id AND order_edit_leases.employee_id=excluded.employee_id`)
 .bind(token,orderId,employee.id,employee.name,now+leaseMs,orderId,employee.id,now).run();
 const holder=await d.prepare('SELECT employee_name FROM order_edit_leases WHERE order_id=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1').bind(orderId,now).first<{employee_name:string}>();
 return {editable:result.meta.changes===1,holder:holder?.employee_name,leaseMs};
}

export async function releaseOrderAccess(employeeId:string,token:string){
 await initOrderAccess();
 await db().prepare('DELETE FROM order_edit_leases WHERE token=? AND employee_id=?').bind(token,employeeId).run();
}
