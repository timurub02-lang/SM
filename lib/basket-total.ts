import type {Item} from './crm.ts';
export const isBasketTotal=(item:Pick<Item,'name'>)=>item.name.trim().toLocaleUpperCase('ru')==='ИТОГО';
export const basketAmount=(items:Item[])=>items.reduce((sum,item)=>sum+item.quantity*Math.round(item.price*100),0)/100;
// Keep the existing warehouse/LV total line so delivery, payroll and old releases read the same amount.
export function withBasketTotal(items:Item[],amount:number):Item[]{
 const name=items.find(isBasketTotal)?.name||'ИТОГО';
 return [...items.filter(item=>!isBasketTotal(item)).map(item=>({...item,price:0})),{name,quantity:1,price:Math.round(amount*100)/100}];
}
