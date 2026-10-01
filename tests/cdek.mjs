import assert from 'node:assert/strict';
import {authorizeCdek} from '../lib/cdek.ts';
assert.equal(await authorizeCdek('key','secret',async(url,options)=>{assert.equal(url,'https://api.cdek.ru/v2/oauth/token');assert.equal(options.body.get('client_id'),'key');assert.equal(options.body.get('client_secret'),'secret');assert.equal(options.body.get('grant_type'),'client_credentials');return Response.json({access_token:'private-token'});}),true);
await assert.rejects(authorizeCdek('key','secret',async()=>new Response('sensitive upstream detail',{status:401})),/СДЭК отклонил/);
await assert.rejects(authorizeCdek('key','secret',async()=>Response.json({})),/не выдал токен/);
console.log('CDEK authorization checks passed');
