import assert from 'node:assert/strict';
const Original=Intl.DateTimeFormat;let constructions=0;
Intl.DateTimeFormat=new Proxy(Original,{construct(target,args){constructions++;return Reflect.construct(target,args);}});
try{
 const {moscowDate,repeatSales,previousThreeMonths}=await import('../lib/base-distribution.ts');
 assert.equal(moscowDate(new Date('2026-11-11T20:59:59Z')),'2026-11-11');
 assert.equal(moscowDate(new Date('2026-11-11T21:00:00Z')),'2026-11-12');
 assert.equal(moscowDate(new Date('2024-02-29T21:00:00Z')),'2024-03-01');
 assert.deepEqual(previousThreeMonths(new Date('2026-01-01T00:00:00Z')),{from:'2025-10-01',to:'2025-12-31'});
 const orders=Array.from({length:7000},(_,i)=>({clientId:'c'+i%3500,manager:'operator',status:'redeemed',redeemedAt:'2026-11-11T21:00:00Z'}));
 assert.deepEqual(repeatSales(orders,'2026-11-12','2026-11-12').operator,{clients:3500,repeats:3500,repeatClients:3500,percent:100,coverage:100});
 assert.deepEqual(repeatSales(orders,'2026-11-11','2026-11-11'),{});
 assert.equal(constructions,1,'A full order scan must not allocate an ICU formatter per row');
 console.log('Moscow dates: calendar boundaries, repeat totals and one formatter for 14,000 orders passed');
}finally{Intl.DateTimeFormat=Original;}
