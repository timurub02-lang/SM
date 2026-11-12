import {createHash} from 'node:crypto';
import {brotliCompress,constants} from 'node:zlib';
import {promisify} from 'node:util';
const compress=promisify(brotliCompress);
export async function conditionalJson(request:Request,value:unknown){
 const body=JSON.stringify(value);
 const encodings=(request.headers.get('accept-encoding')||'').toLowerCase().split(',').map(part=>{
  const [name,...params]=part.trim().split(';');
  const quality=params.map(p=>p.trim()).find(p=>p.startsWith('q='));
  const q=quality===undefined?1:Number(quality.slice(2));
  return {name,q:Number.isFinite(q)&&q>=0&&q<=1?q:0};
 });
 const br=encodings.find(e=>e.name==='br')?.q||0;
 const brotli=process.env.CRM_RUNTIME==='miran'&&body.length>=1024&&br>0&&!encodings.some(e=>e.q>br);
 const etag='"'+createHash('sha256').update(body).digest('base64url')+(brotli?'.br':'')+'"';
 const headers=new Headers({'ETag':etag,'Cache-Control':'private, no-store','Vary':'Cookie, Accept-Encoding','Content-Type':'application/json; charset=utf-8'});
 if(brotli)headers.set('Content-Encoding','br');
 // Unchanged snapshots avoid compression entirely; auth and visibility run before this helper.
 if(request.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers});
 if(!brotli)return new Response(body,{headers});
 const encoded=await compress(body,{params:{[constants.BROTLI_PARAM_QUALITY]:4}});
 return new Response(new Uint8Array(encoded),{headers});
}
