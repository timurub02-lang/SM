import {createHash} from 'node:crypto';
export function conditionalJson(request:Request,value:unknown){
 const body=JSON.stringify(value),etag='"'+createHash('sha256').update(body).digest('base64url')+'"';
 const headers={'ETag':etag,'Cache-Control':'private, no-store','Vary':'Cookie','Content-Type':'application/json; charset=utf-8'};
 return request.headers.get('if-none-match')===etag?new Response(null,{status:304,headers}):new Response(body,{headers});
}
