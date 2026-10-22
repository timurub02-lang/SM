import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {internalWaybill} from '../lib/internal-waybill.ts';
import {waybillPdf} from '../lib/waybill-pdf.ts';
const data=internalWaybill({id:'1172222',address:'Россия, Санкт-Петербург, Сестрорецк, ул. Токарева, д. 6, кв. 20',logisticComment:'Курьер СДЭК',items:[{name:'Курс',quantity:1,price:11250},{name:'Фури',quantity:3,price:0}]},{name:'Кутюгин Юрий Николаевич',phone:'79213030782',address:'Старый адрес'},{login:'operator-login'});
assert.equal(data.operator,'operator-login');
assert(!data.address.includes('Старый'));
assert.equal(data.callbackPhone,'—');
assert.equal(data.items.reduce((s,i)=>s+i.quantity*i.price,0),11250);
const fonts={regular:readFileSync('public/fonts/LiberationSans-Regular.ttf').toString('base64'),bold:readFileSync('public/fonts/LiberationSans-Bold.ttf').toString('base64')};
const doc=waybillPdf(data,fonts);
assert.equal(doc.getNumberOfPages(),1);
assert(doc.output().startsWith('%PDF-'));
mkdirSync('work/waybill',{recursive:true});
writeFileSync('work/waybill/sample.pdf',Buffer.from(doc.output('arraybuffer')));
const long=waybillPdf({...data,comment:'Длинный комментарий заказа. '.repeat(180),items:Array.from({length:70},(_,i)=>({name:`Товар ${i+1} с длинным названием`,quantity:2,price:100}))},fonts);
assert(long.getNumberOfPages()>1);
writeFileSync('work/waybill/multipage.pdf',Buffer.from(long.output('arraybuffer')));
console.log('PDF signature, data, totals and pagination checks passed');
const batch=waybillPdf([data,{...data,id:'SECOND-ORDER'}],fonts);
assert.equal(batch.getNumberOfPages(),1);
const odd=waybillPdf([data,{...data,id:"SECOND-ORDER"},{...data,id:"THIRD-ORDER"}],fonts);
assert.equal(odd.getNumberOfPages(),2);
writeFileSync("work/waybill/odd.pdf",Buffer.from(odd.output("arraybuffer")));
const longPair=waybillPdf([{...data,comment:'Длинный комментарий. '.repeat(180)}, {...data,id:'SECOND-LONG',items:Array.from({length:70},(_,i)=>({name:`Товар ${i+1}`,quantity:1,price:1}))}, {...data,id:'LAST-ORDER'}],fonts);
assert(longPair.getNumberOfPages()>2);
writeFileSync('work/waybill/long-pair.pdf',Buffer.from(longPair.output('arraybuffer')));
assert.throws(()=>waybillPdf([],fonts),/Нет накладных/);
writeFileSync('work/waybill/batch.pdf',Buffer.from(batch.output('arraybuffer')));
console.log('Batch PDF checks passed');
const callbacks={phones:['88001112233','88004445566'],departments:{'1':'1','2':'2','3':'1'}};
for(const [department,expected] of [['1','88001112233'],['2','88004445566'],['3','88001112233'],[undefined,'—']]){
 assert.equal(internalWaybill({id:'test',items:[]},{name:'Клиент',phone:''},{login:'operator',department},callbacks).callbackPhone,expected);
}
assert.equal(internalWaybill({id:'test',items:[]},{name:'Клиент',phone:''},{department:'2'},{...callbacks,departments:{'2':''}}).callbackPhone,'—');
console.log('Department callback selection and unassigned fallback passed');

assert.equal(internalWaybill({id:'test',items:[]},{name:'Клиент',phone:''},undefined,{...callbacks,printBoth:true}).callbackPhone,'88001112233 · 88004445566');

assert.equal(data.comment,internalWaybill({items:[],logisticComment:data.comment,waybillComment:"old"},{}).comment);
assert.equal(internalWaybill({items:[],waybillComment:"old",comment:"operator"},{}).comment,"—");

const {selectedPackingOrders}=await import("../lib/internal-waybill.ts");
const calculated={id:"a",status:"packing",delivery:"cdek_courier",cdekTariff:{}};
const waiting={...calculated,id:"b",cdekTariff:{needsConfirmation:true}};
const printed={...calculated,id:"c",packingWaybillAt:"2026-10-22"};
assert.deepEqual(selectedPackingOrders([calculated,waiting,printed],[]),[]);
assert.deepEqual(selectedPackingOrders([calculated,waiting,printed],["a","a","b","c","missing"]).map(o=>o.id),["a"]);
assert.deepEqual(selectedPackingOrders([calculated,{...calculated,id:"d"}],["d"]).map(o=>o.id),["d"]);
