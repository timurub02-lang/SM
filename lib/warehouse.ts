import {z} from 'zod';
export const productSchema=z.object({tag:z.string().trim().max(80).prefault(""),name:z.string().trim().min(1).max(255),sku:z.string().trim().max(20),weight:z.number().int().positive().max(100000000).nullable(),cost:z.number().min(0).max(100000000).nullable(),packedWeight:z.number().positive().nullable().prefault(null),length:z.number().int().positive().max(1000).nullable().prefault(null),width:z.number().int().positive().max(1000).nullable().prefault(null),height:z.number().int().positive().max(1000).nullable().prefault(null),originMode:z.enum(['warehouse','door']).prefault('warehouse'),payment:z.number().min(0).max(100000000).nullable()});
export type Product=z.infer<typeof productSchema>&{id:string;version:number;stock?:{available:number;reserved:number;sold:number;supplied:number};nameLocked?:boolean;lv?:{id:string;name:string;syncedAt:string;active:boolean;blocked:boolean}};
export const productReady=(p:z.infer<typeof productSchema>)=>!!p.name&&!!p.sku&&p.weight!==null&&p.cost!==null;

export function parcelDefaults(items:{name:string;quantity:number}[],products:Product[]){
 const matches=items.map(i=>products.find(p=>p.name.trim().toLowerCase()===i.name.trim().toLowerCase()));
 if(!matches.length||matches.some(p=>!p))return null;
 const dimension=(key:'length'|'width'|'height')=>matches.every(p=>p?.[key])?Math.max(...matches.map(p=>p![key]!)):null;
 return {weight:0.875,length:dimension('length'),width:dimension('width'),height:dimension('height'),originMode:matches[0]!.originMode};
}

export const warehouseAddressSchema=z.string().trim().min(1).max(500).refine(v=>/(?:^|\D)\d{6}(?!\d)/.test(v),"Укажите в адресе шестизначный индекс").transform(address=>({address,postalCode:address.match(/(?:^|\D)(\d{6})(?!\d)/)![1]}));
