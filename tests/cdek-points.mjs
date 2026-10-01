import assert from 'node:assert/strict';
import {rankRecipientPoints} from '../lib/cdek-points.ts';
const points=[{code:'other',address:'350001, Краснодар, ул. Ленина, 15'},{code:'postal',address:'350063, Краснодар, ул. Мира, 5'},{code:'partial',address:'350001, Краснодар, ул. Ленинградская, 1'},{code:'both',address:'350063, Краснодар, улица имени Ленина, 2'}];
assert.deepEqual(rankRecipientPoints(points,{postalCode:'350063',street:'ул им. Ленина'}).map(p=>p.code),['both','other','postal','partial']);
assert(!rankRecipientPoints(points,{street:'Ленина'}).find(p=>p.code==='partial').sameStreet);
assert(rankRecipientPoints([{code:'1',address:'Орёл, ул. Артема, 3',postalCode:'302000'}],{street:'улица Артёма',postalCode:'302000'})[0].sameStreet);
assert(rankRecipientPoints(points,{}).every(p=>!p.sameStreet&&!p.samePostalCode));
assert.equal(points[0].code,'other');
console.log('Pickup street and postcode ranking passed');
