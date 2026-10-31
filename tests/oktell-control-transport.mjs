import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pilotControl} from '../lib/oktell-pilot-control.ts';
const socket=process.platform==='win32'?'\\\\.\\pipe\\crm-review-'+process.pid:join(tmpdir(),'crm-review-'+process.pid+'.sock');
process.env.OKTELL_CONTROL_SOCKET=socket;
const server=http.createServer((req,res)=>{
 if(req.url==='/broken'){res.writeHead(200,{'Content-Type':'application/json'});res.write('{"partial":');setTimeout(()=>res.destroy(),10);}
 else if(req.url==='/large')res.end('x'.repeat(1100000));
 else res.end('{"ok":true}');
});
server.listen(socket);await once(server,'listening');
try{
 await assert.rejects(pilotControl('/broken'),/aborted|reset|socket/i);
 await assert.rejects(pilotControl('/large'),/слишком большой/);
 assert.deepEqual(await pilotControl('/healthy'),{ok:true});
 console.log('Oktell transport: partial response and size failures handled; subsequent requests succeed.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));delete process.env.OKTELL_CONTROL_SOCKET;}
