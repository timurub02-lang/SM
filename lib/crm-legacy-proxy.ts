import type {Employee} from './crm.ts';

const roles=new Set(['admin','logistic','chief_logistic','redemption','courier']);
export const legacySnapshotWorker=()=>process.env.CRM_RUNTIME==='miran'&&process.env.CRM_LEGACY_SNAPSHOT_WORKER==='1';
export function legacySnapshotRequest(request:Request){
 const url=new URL(request.url),params=url.searchParams;
 return request.method==='GET'&&url.pathname==='/api/crm'&&params.get('transport')==='compact-v1'&&
  [...params.keys()].every(key=>['transport','actorId'].includes(key)&&params.getAll(key).length===1);
}
const unavailable=()=>Response.json({error:'Рабочие данные временно недоступны. Повторите загрузку.'},{status:503,headers:{'Cache-Control':'no-store'}});

// Snapshot CPU isolation, not a read-only database: existing GET maintenance semantics are retained.
export async function proxyLegacySnapshot(request:Request,employee?:Employee,send:typeof fetch=fetch):Promise<Response|null>{
 const eligible=!!employee&&roles.has(employee.role)&&legacySnapshotRequest(request)&&
  (!new URL(request.url).searchParams.has('actorId')||new URL(request.url).searchParams.get('actorId')===employee.id);
 // Re-authentication on the worker must reject an actor whose role changed during the hop.
 if(legacySnapshotWorker())return eligible?null:Response.json({error:'Недостаточно прав'},{status:403});
 if(process.env.CRM_RUNTIME!=='miran'||!process.env.CRM_LEGACY_SNAPSHOT_ORIGIN||!eligible)return null;
 try{
  const configured=process.env.CRM_LEGACY_SNAPSHOT_ORIGIN;
  // Literal IPv4 loopback only: no DNS, URL credentials, alternate numeric hosts or redirect targets.
  if(!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(configured))return unavailable();
  const origin=new URL(configured);
  if(!origin.port||Number(origin.port)>65535||origin.origin===new URL(request.url).origin)return unavailable();
  const timeout=Number(process.env.CRM_LEGACY_SNAPSHOT_TIMEOUT_MS||30000);
  if(!Number.isInteger(timeout)||timeout<100||timeout>120000)return unavailable();
  const headers=new Headers({'Accept':'application/json','Accept-Encoding':'identity'});
  for(const key of ['cookie','if-none-match']){const value=request.headers.get(key);if(value)headers.set(key,value);}
  const response=await send(origin.origin+new URL(request.url).pathname+new URL(request.url).search,{
   method:'GET',headers,cache:'no-store',redirect:'error',signal:AbortSignal.any([request.signal,AbortSignal.timeout(timeout)])
  });
  // Fetch may decompress an upstream response. Never forward its encoded length/encoding.
  const output=new Headers({'Cache-Control':'private, no-store'});
  for(const key of ['etag','vary','content-type','server-timing']){const value=response.headers.get(key);if(value)output.set(key,value);}
  return new Response(response.body,{status:response.status,headers:output});
 }catch{return unavailable();}
}
