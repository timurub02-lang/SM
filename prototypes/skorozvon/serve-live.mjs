import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const files=new Map([['/',['live.html','text/html']],['/style.css',['style.css','text/css']],['/live.css',['live.css','text/css']],['/live.mjs',['live.mjs','text/javascript']],['/live-model.mjs',['live-model.mjs','text/javascript']]]);
// The vendor uses runtime templates and inline styles; exceptions are isolated from the demo and CRM.
const csp="default-src 'none'; script-src 'self' https://widget.skorozvon.ru 'unsafe-eval'; style-src 'self' https://widget.skorozvon.ru 'unsafe-inline'; img-src 'self' data: https://*.skorozvon.ru; font-src data: https://*.skorozvon.ru; connect-src 'self' https://*.skorozvon.ru wss://*.skorozvon.ru; media-src blob: https://*.skorozvon.ru; frame-src https://app.skorozvon.ru https://widget.skorozvon.ru; worker-src blob:; object-src 'none'; base-uri 'none'; form-action 'self' https://*.skorozvon.ru; frame-ancestors 'none'";
export function createLiveServer(testNumber=''){
  if(testNumber&&!/^\+7\d{10}$/.test(testNumber))throw new Error('SK_WIDGET_TEST_PHONE must be in +7XXXXXXXXXX format');
  let claimed=false;
  return http.createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'microphone=(self), camera=(), geolocation=()','Content-Security-Policy':csp};
    const host=req.headers.host||'';
    if(!/^127\.0\.0\.1:\d+$/.test(host)){res.writeHead(403,headers);res.end('Local access only');return;}
    const url=new URL(req.url,`http://${host}`);
    if(url.search){res.writeHead(400,headers);res.end('Open the local address without query parameters');return;}
    if(url.pathname==='/test-call'){
      const json={...headers,'Content-Type':'application/json'};
      if(req.method==='GET'){res.writeHead(200,json);res.end(JSON.stringify({configured:!!testNumber,claimed}));return;}
      if(req.method!=='POST'){res.writeHead(405,headers);res.end();return;}
      if(req.headers.origin!==`http://${host}`||req.headers['x-test-call']!=='1'){res.writeHead(403,headers);res.end();return;}
      if(!testNumber||claimed){res.writeHead(409,headers);res.end();return;}
      // Consume before returning the number, including when a tab loses the response.
      claimed=true;
      res.writeHead(200,json);res.end(JSON.stringify({number:testNumber}));return;
    }
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,headers);res.end('Read only');return;}
    const file=files.get(url.pathname);
    if(!file){res.writeHead(404,headers);res.end('Not found');return;}
    try{const body=await readFile(new URL(file[0],import.meta.url));res.writeHead(200,{...headers,'Content-Type':`${file[1]}; charset=utf-8`});res.end(req.method==='HEAD'?undefined:body);}
    catch{res.writeHead(500,headers);res.end('Unable to read widget files');}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.argv[2]||4179);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Use a port from 1024 to 65535');
  const server=createLiveServer(process.env.SK_WIDGET_TEST_PHONE);server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`Local real Skorozvon widget: http://127.0.0.1:${port}`));
}
