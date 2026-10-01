import assert from 'node:assert/strict';
import {checkSkorozvon} from '../lib/skorozvon.ts';
const config={login:'test@example.invalid',apiKey:'test-api',clientId:'test-id',clientSecret:'test-secret'};
const calls=[];
const result=await checkSkorozvon(config,async(url,init)=>{calls.push({url,init});return calls.length===1?Response.json({access_token:'test-token'}):Response.json({data:[]});});
assert.ok(result.checkedAt);assert.equal(calls.length,2);assert.equal(calls[0].init.body.get('api_key'),config.apiKey);assert.equal(calls[0].init.body.get('grant_type'),'password');assert.equal(calls[1].init.headers.Authorization,'Bearer test-token');assert.equal(calls[1].init.method,undefined);assert.ok(calls[1].url.endsWith('/users?length=1'));assert.equal(calls[0].init.redirect,'error');
await assert.rejects(checkSkorozvon(config,async()=>new Response('secret upstream details',{status:401})),/отклонил реквизиты/);
await assert.rejects(checkSkorozvon(config,async()=>{throw Error('network-secret');}),e=>!e.message.includes('network-secret'));
await assert.rejects(checkSkorozvon(config,async()=>Response.json({})),/не выдал токен/);
let n=0;await assert.rejects(checkSkorozvon(config,async()=>++n===1?Response.json({access_token:'token'}):new Response('',{status:403})),/доступ к API/);
console.log('Skorozvon: authorization, read-only probe, safe errors and invalid responses passed');

let bare=0;assert.ok((await checkSkorozvon(config,async()=>++bare===1?Response.json({access_token:"token"}):Response.json([{id:1}]))).checkedAt);
