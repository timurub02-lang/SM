import {createHash} from 'node:crypto';
export async function conditionalJson(request:Request,value:unknown){
 const body=JSON.stringify(value);
 const etag='"'+createHash('sha256').update(body).digest('base64url')+'"';
 const headers=new Headers({'ETag':etag,'Cache-Control':'private, no-store','Vary':'Cookie, Accept-Encoding','Content-Type':'application/json; charset=utf-8'});
 if(request.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers});
 // Next owns HTTP compression so the body and Content-Encoding stay consistent.
 return new Response(body,{headers});
}
