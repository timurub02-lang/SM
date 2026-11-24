import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const files=new Map([['/',['index.html','text/html']],['/style.css',['style.css','text/css']],['/app.mjs',['app.mjs','text/javascript']],['/model.mjs',['model.mjs','text/javascript']]]);
export function createPrototypeServer(){
  return http.createServer(async(req,res)=>{
    const host=req.headers.host||'';
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'microphone=(), camera=(), geolocation=()','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
    if(!/^127\.0\.0\.1:\d+$/.test(host)){res.writeHead(403,headers);res.end('Local access only');return;}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,headers);res.end('Read only');return;}
    const file=files.get(new URL(req.url,`http://${host}`).pathname);
    if(!file){res.writeHead(404,headers);res.end('Not found');return;}
    try{const data=await readFile(new URL(file[0],import.meta.url));res.writeHead(200,{...headers,'Content-Type':`${file[1]}; charset=utf-8`});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(500,headers);res.end('Unable to read prototype file');}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.argv[2]||4178);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Use a port from 1024 to 65535');
  const server=createPrototypeServer();
  server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`Local synthetic prototype: http://127.0.0.1:${port}`));
}
