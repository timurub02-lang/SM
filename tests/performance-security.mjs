import assert from 'node:assert/strict';
import {SnapshotReader} from '../lib/snapshot-reader.ts';
import {conditionalJson} from '../lib/conditional-json.ts';
import {readLimitedText,BodyTooLarge} from '../lib/request-body.ts';
import {byteRange} from '../lib/byte-range.ts';
import {visibleState} from '../lib/permissions.ts';
const url='https://crm.test/api/crm';
const originalFetch=globalThis.fetch;
try{
 globalThis.fetch=function(){assert.ok(this===undefined||this===globalThis,'Fetch must not receive SnapshotReader as its browser receiver');return Promise.resolve(Response.json({ok:true}));};
 assert.deepEqual(await new SnapshotReader(url).read(),{ok:true});
}finally{globalThis.fetch=originalFetch;}
let requests=0,finish;
const reader=new SnapshotReader(url,()=>{requests++;return new Promise(resolve=>finish=resolve);});
const first=reader.read(),second=reader.read();assert.equal(first,second);assert.equal(requests,1);
finish(Response.json({version:1},{headers:{etag:'"1"'}}));assert.deepEqual(await first,{version:1});
let headers;
const unchanged=new SnapshotReader(url,async(_url,options)=>{headers=options.headers;return headers['If-None-Match']?new Response(null,{status:304}):Response.json({version:1},{headers:{etag:'"1"'}});});
const value=await unchanged.read();assert.equal(await unchanged.read(),value);assert.equal(headers['If-None-Match'],'"1"');
const stale=reader.read(),staleFinish=finish;reader.invalidate();const fresh=reader.read();const freshFinish=finish;
// Even a transport that ignores cancellation cannot apply its obsolete response.
freshFinish(Response.json({version:3}));assert.deepEqual(await fresh,{version:3});
staleFinish(Response.json({version:2}));assert.equal(await stale,null);
// Independent delayed old response, after a successful mutation.
let oldFinish;const oldReader=new SnapshotReader(url,()=>new Promise(resolve=>oldFinish=resolve));
const old=oldReader.read();oldReader.invalidate();oldFinish(Response.json({version:0}));assert.equal(await old,null);
const failed=new SnapshotReader(url,async()=>Response.json({error:'Требуется вход'},{status:401}));
await assert.rejects(failed.read(),{status:401});
const response=conditionalJson(new Request(url),{private:'one'}),etag=response.headers.get('etag');
assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
assert.equal(conditionalJson(new Request(url,{headers:{'If-None-Match':etag}}),{private:'one'}).status,304);
assert.equal(conditionalJson(new Request(url,{headers:{'If-None-Match':etag}}),{private:'two'}).status,200);
let cancelled=false;
const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(6));},cancel(){cancelled=true;}});
await assert.rejects(readLimitedText(new Request(url,{method:'POST',body,duplex:'half'}),10),BodyTooLarge);assert.equal(cancelled,true);
assert.equal(await readLimitedText(new Request(url,{method:'POST',body:'Привет'}),12),'Привет');
await assert.rejects(readLimitedText(new Request(url,{method:'POST',body:'Привет'}),11),BodyTooLarge);
for(const [header,expected] of [[null,{start:0,end:99}],['bytes=10-19',{start:10,end:19}],['bytes=90-',{start:90,end:99}],['bytes=-10',{start:90,end:99}],['bytes=0-1000',{start:0,end:99}],['bytes=-0',null],['bytes=100-',null],['bytes=20-10',null],['bytes=0-1,3-4',null],['bytes=0-9999999999999999999999',null]])assert.deepEqual(byteRange(header,100),expected,header||'whole file');
const operator={id:'one',role:'operator',department:'1'},head={id:'head',role:'department_head',department:'1'},admin={id:'admin',role:'admin'};
const client={id:'client',owner:'one',phone:'+79990000001',linkedPhones:['+79990000002'],importFields:{Phone:'+79990000003'}};
const state={clients:[client],orders:[],employees:[operator,head,admin],events:[],settings:{retentionDays:30}};
for(const actor of [operator,head]){const output=visibleState(state,actor);assert.equal(output.clients.length,1);assert.ok(!JSON.stringify(output).includes('+7999'));}
assert.equal(visibleState(state,admin).clients[0],client);
console.log('PASS: single-flight/304/obsolete reads, auth errors, private ETags, bounded Unicode/chunked bodies, byte ranges and phone privacy');
