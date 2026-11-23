'use client';
import {useState} from 'react';
import {Pencil} from 'lucide-react';
import {AddressField,useOrderAddressReview} from './address-field';
import {emptyAddressParts} from '@/lib/address';
import type {Order} from '@/lib/crm';

type Props={order:Order;address:string;busy:boolean;mutate:(data:Record<string,unknown>)=>Promise<boolean>};
export function CourierOrderAddress(props:Props){
 const [editing,setEditing]=useState(false);
 if(editing)return <AddressEditor {...props} close={()=>setEditing(false)}/>;
 return <p className="courier-address">{props.address||'Адрес не указан'} <button className="courier-address-pencil" type="button" title="Изменить адрес доставки" aria-label="Изменить адрес доставки" disabled={props.busy} onClick={()=>setEditing(true)}><Pencil size={17}/></button></p>;
}
function AddressEditor({order,address:original,busy,mutate,close}:Props&{close:()=>void}){
 const [version]=useState(order.version),[address,setAddress]=useState(original),[parts,setParts]=useState(order.addressParts||emptyAddressParts);
 const review=useOrderAddressReview(order.id,address,parts,busy,'Сохранить адрес');
 async function save(confirmed:boolean){
  if(await mutate({action:'courierWorkflow',operation:'editAddress',id:order.id,version,address,addressParts:parts,addressConfirmed:confirmed}))close();
 }
 return <div className="courier-address-editor" ref={review.ref}>
  <AddressField value={address} parts={parts} disabled={busy} warnings={review.warnings} reviewAction="Сохранить адрес" onChange={(value,next)=>{setAddress(value);setParts(next||emptyAddressParts);review.reset();}}/>
  <div className="courier-buttons"><button type="button" className="primary" disabled={busy||!address.trim()} onClick={()=>review.review(save)}>Сохранить адрес</button><button type="button" className="secondary" disabled={busy} onClick={close}>Отмена</button></div>{review.dialog}
 </div>;
}
