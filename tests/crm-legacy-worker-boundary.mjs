import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url),{NextRequest}=require('next/server');
const compiled=await build({entryPoints:[new URL('../proxy.ts',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,write:false,format:'cjs',platform:'node',packages:'external'});
const module={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(require,module,module.exports);
const {proxy}=module.exports;
const saved={runtime:process.env.CRM_RUNTIME,worker:process.env.CRM_LEGACY_SNAPSHOT_WORKER};
try{
 process.env.CRM_RUNTIME='miran';delete process.env.CRM_LEGACY_SNAPSHOT_WORKER;
 for(const path of ['/','/api/crm','/api/sk-order-events','/login'])for(const method of ['GET','POST'])assert.equal(proxy(new NextRequest('http://127.0.0.1:3101'+path,{method})).headers.get('x-middleware-next'),'1','default web boundary is a no-op');
 process.env.CRM_LEGACY_SNAPSHOT_WORKER='1';
 const health=proxy(new NextRequest('http://127.0.0.1:3101/api/crm-worker-health'));assert.equal(health.status,200);assert.deepEqual(await health.json(),{ok:true});
 assert.equal(proxy(new NextRequest('http://127.0.0.1:3101/api/crm?transport=compact-v1')).headers.get('x-middleware-next'),'1');
 for(const path of ['/','/login','/api/crm','/api/sk-order-events','/api/crm?transport=compact-v1&part=card','/api/crm?transport=compact-v1&transport=compact-v1'])assert.equal(proxy(new NextRequest('http://127.0.0.1:3101'+path)).status,403);
 for(const method of ['POST','PUT','PATCH','DELETE','HEAD','OPTIONS'])assert.equal(proxy(new NextRequest('http://127.0.0.1:3101/api/crm?transport=compact-v1',{method})).status,403);
 console.log('PASS legacy worker request boundary: default no-op, GET snapshot/health only, mutation/integration paths rejected');
}finally{
 for(const [key,value] of [['CRM_RUNTIME',saved.runtime],['CRM_LEGACY_SNAPSHOT_WORKER',saved.worker]])if(value===undefined)delete process.env[key];else process.env[key]=value;
}
