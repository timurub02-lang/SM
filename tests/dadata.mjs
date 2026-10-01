import assert from 'node:assert/strict';
import {suggestAddress} from '../lib/dadata.ts';
import {suggestionParts,emptyAddressParts,formatAddress,addressPartsSchema} from '../lib/address.ts';
import {clientSchema,validateTransition} from '../lib/crm.ts';
let called=false;
const results=await suggestAddress('test-token','Москва',async(url,options)=>{
 called=true;assert.equal(new URL(url).hostname,'suggestions.dadata.ru');assert.equal(options.headers.Authorization,'Token test-token');assert.deepEqual(JSON.parse(options.body),{query:'Москва',count:5,locations:[{country_iso_code:'RU'}]});return Response.json({suggestions:[{value:'Москва',unrestricted_value:'101000, г Москва'}]});
});
assert(called);assert.deepEqual(results,[{value:'101000, г Москва',parts:emptyAddressParts}]);
const parts=suggestionParts({postal_code:'123456',region_with_type:'Московская обл',city_with_type:'г Химки',settlement_with_type:'мкр Подрезково',street_with_type:'ул Центральная',house_type:'д',house:'4',block_type:'к',block:'2',flat_type:'кв',flat:'17'});
assert.equal(parts.city,'г Химки, мкр Подрезково');assert.equal(parts.house,'д 4, к 2');assert.equal(parts.flat,'кв 17');assert.equal(parts.postalCode,'123456');assert.deepEqual(suggestionParts({}),emptyAddressParts);assert(formatAddress(parts).includes('кв 17'));assert(addressPartsSchema.safeParse(parts).success);
await assert.rejects(suggestAddress('bad','Москва',async()=>new Response('',{status:403})),/ключ/);
await assert.rejects(suggestAddress('bad','Москва',async()=>Response.json({})),/некорректный/);
const order={status:'draft',address:'Москва, ул Тверская, д 1',items:[{}]};
assert.doesNotThrow(()=>validateTransition(order,'confirm',{address:''},''));
assert.throws(()=>validateTransition({...order,address:''},'confirm',{address:'Другой адрес'},''),/адрес/);
console.log('DaData request, errors and order-address checks passed');

const client=clientSchema.parse({name:"Тест",phone:"79000000000",address:formatAddress(parts),city:parts.city,addressParts:parts});
assert.deepEqual(client.addressParts,parts);assert.equal(client.city,parts.city);
assert.equal(clientSchema.parse({name:"Тест",phone:"79000000000"}).addressParts,undefined);
const {cleanImportedAddress}=await import('../lib/dadata.ts');
const keys={token:'test',secret:'test'};
const recognized=await cleanImportedAddress('мск сухонска 11',keys,async(url,options)=>{assert.equal(new URL(url).hostname,'cleaner.dadata.ru');assert.deepEqual(JSON.parse(options.body),['мск сухонска 11']);assert.equal(options.headers['X-Secret'],'test');return Response.json([{qc:0,result:'г Москва, ул Сухонская, д 11',region_with_type:'г Москва',region_type:'г',house:'11',house_type:'д'}]);});
assert.equal(recognized.city,'г Москва');assert.equal(recognized.addressOriginal,'мск сухонска 11');assert.equal(recognized.addressParts.house,'д 11');
for(const qc of [1,2,3]){const unknown=await cleanImportedAddress('Обещанны',keys,async()=>Response.json([{qc,result:'случайный вариант'}]));assert.equal(unknown.address,'Обещанны');assert.deepEqual(unknown.addressParts,emptyAddressParts);assert(unknown.addressReview);}
const unavailable=await cleanImportedAddress('Обещанны',keys,async()=>new Response('',{status:503}));assert.equal(unavailable.address,'Обещанны');assert(unavailable.addressProcessingError);
console.log('Excel address preservation and normalization checks passed');
