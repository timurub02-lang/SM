'use client';
import {useState} from 'react';
import {canReceivePayment,type Order,type Employee} from '@/lib/crm';
import {canReceiveWarehouseReturn} from '@/lib/warehouse-return';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
export function OrderReceiptActions({order:o,employee,busy,mutate}:{order:Order;employee:Employee;busy:boolean;mutate:(p:Record<string,unknown>)=>Promise<boolean>}){
 const [open,setOpen]=useState(false),[received,setReceived]=useState(false);
 const payment=canReceivePayment(o,employee.role),warehouse=canReceiveWarehouseReturn(o,employee.role);
 if(!payment&&!warehouse)return null;
 return <><div className="order-quick-bar"><div className="order-quick-buttons">{payment&&<button type="button" className="primary" disabled={busy} onClick={()=>void mutate({action:'receivePayment',id:o.id,version:o.version})}>Принять оплату — деньги получены</button>}{warehouse&&<button type="button" className="primary" disabled={busy} onClick={()=>{setReceived(false);setOpen(true);}}>Возврат на склад ▾</button>}</div></div><Dialog open={open&&warehouse} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent className="form-dialog order-quick-dialog"><DialogHeader><DialogTitle>Принять возврат на склад</DialogTitle><DialogDescription>{o.id}</DialogDescription></DialogHeader><p>Подтвердите приём только после фактического получения посылки. Товары вернутся в доступный остаток.</p><label><input type="checkbox" checked={received} disabled={busy} onChange={e=>setReceived(e.target.checked)}/> Посылка фактически получена</label><button type="button" className="primary" disabled={busy||!received} onClick={async()=>{if(await mutate({action:'returnToWarehouse',id:o.id,version:o.version,confirmed:true}))setOpen(false);}}>Принять возврат на склад</button></DialogContent></Dialog></>;
}
