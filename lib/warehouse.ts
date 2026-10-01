import {z} from 'zod';
export const productSchema=z.object({tag:z.string().trim().max(80).default(""),name:z.string().trim().min(1).max(255),sku:z.string().trim().max(20),weight:z.number().int().positive().max(100000000).nullable(),cost:z.number().min(0).max(100000000).nullable(),packedWeight:z.number().positive().nullable().default(null),length:z.number().int().positive().max(1000).nullable().default(null),width:z.number().int().positive().max(1000).nullable().default(null),height:z.number().int().positive().max(1000).nullable().default(null),originMode:z.enum(['warehouse','door']).default('warehouse'),payment:z.number().min(0).max(100000000).nullable()});
export type Product=z.infer<typeof productSchema>&{id:string;version:number;stock?:{available:number;reserved:number;sold:number;supplied:number};nameLocked?:boolean};
export const productReady=(p:z.infer<typeof productSchema>)=>!!p.name&&!!p.sku&&p.weight!==null&&p.cost!==null&&p.payment!==null;

export function parcelDefaults(items:{name:string;quantity:number}[],products:Product[]){
 const matches=items.map(i=>({item:i,p:products.find(p=>p.name.trim().toLowerCase()===i.name.trim().toLowerCase())}));
 if(!matches.length||matches.some(x=>!x.p?.packedWeight))return null;
 const single=matches.length===1&&matches[0].item.quantity===1?matches[0].p:null;
 return {weight:Math.round(matches.reduce((n,x)=>n+x.p!.packedWeight!*x.item.quantity,0)*1000)/1000,length:single?.length??null,width:single?.width??null,height:single?.height??null,originMode:single?.originMode||'warehouse',single:!!single};
}

export const warehouseAddressSchema=z.string().trim().min(1).max(500).refine(v=>/(?:^|\D)\d{6}(?!\d)/.test(v),"Укажите в адресе шестизначный индекс").transform(address=>({address,postalCode:address.match(/(?:^|\D)(\d{6})(?!\d)/)![1]}));
