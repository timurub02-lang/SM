import assert from 'node:assert/strict';
import {pilotSchema,pilotOperatorLinked} from '../lib/oktell-pilot.ts';
const p={name:'Synthetic pilot',state:'draft',contacts:[1,2,3].map(n=>({name:`Test ${n}`,phone:`+7999000000${n}`})),operatorIds:['E-test-a','E-test-b'],mode:'predictive',ringSeconds:50,maxAttempts:3,order:'attempt_count_ascending',timezone:'Europe/Moscow',schedule:[{day:6,from:'06:00',to:'07:00'},{day:6,from:'08:00',to:'20:00'}],clientWindow:{from:'09:00',to:'20:00'},retries:['busy','no_answer','declined','lost','answering_machine','error'].map(result=>({result,kind:'after',minutes:30,attempts:5})),results:['Callback'],telephony:'existing_oktell_only'};
assert.equal(pilotSchema.parse(p).state,'draft');
for(const change of [{state:'active'},{contacts:[...p.contacts,p.contacts[0]]},{contacts:[p.contacts[0],p.contacts[0],p.contacts[2]]},{operatorIds:['E-test-a','E-test-a']},{schedule:[{day:6,from:'06:00',to:'09:00'},{day:6,from:'08:00',to:'20:00'}]},{clientWindow:{from:'20:00',to:'09:00'}},{retries:Array(6).fill(p.retries[0])},{unexpected:true}])assert.equal(pilotSchema.safeParse({...p,...change}).success,false);
assert.equal(pilotOperatorLinked({role:'operator',oktell:{requested:true,status:'linked',userId:'fixture',login:'test'}}),true);
for(const e of [{role:'admin'},{role:'operator'},{role:'operator',oktell:{requested:false,status:'linked',userId:'fixture',login:'test'}},{role:'operator',oktell:{requested:true,status:'pending',login:'test'}}])assert.equal(pilotOperatorLinked(e),false);
console.log('PASS: draft-only pilot, exactly three distinct contacts and two operators, retry outcomes, schedule validation, linked accounts');

const native={projectId:'10000000-0000-4000-8000-000000000001',taskId:'10000000-0000-4000-8000-000000000002',listId:'10000000-0000-4000-8000-000000000003',verifiedAt:'2026-10-28T19:00:00Z',active:false,operatorUserIds:['10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005'],line:'Existing test line'};
assert.equal(pilotSchema.safeParse({...p,state:'paused',native}).success,true);
assert.equal(pilotSchema.safeParse({...p,state:'paused'}).success,false);
assert.equal(pilotSchema.safeParse({...p,state:'paused',native:{...native,active:true}}).success,false);
assert.equal(pilotSchema.safeParse({...p,native:{...native,operatorUserIds:Array(2).fill(native.operatorUserIds[0])}}).success,false);
