// Keep one read in flight; a completed write must never be replaced by an older read.
export class SnapshotReader<T> {
 private pending:Promise<T|null>|undefined;
 private controller:AbortController|undefined;
 private generation=0;
 private etag='';
 private value:T|undefined;
 private url:string;
 private request:typeof fetch;
 constructor(url:string,request:typeof fetch=(...args)=>fetch(...args)){this.url=url;this.request=request;}
 invalidate(){this.generation++;this.controller?.abort();this.pending=undefined;this.etag='';this.value=undefined;}
 read():Promise<T|null>{
  if(this.pending)return this.pending;
  const generation=this.generation,controller=new AbortController();this.controller=controller;
  const pending=(async()=>{
   try{
    const response=await this.request(this.url,{cache:'no-store',headers:this.etag?{'If-None-Match':this.etag}:{},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
    if(generation!==this.generation)return null;
    if(response.status===304&&this.value!==undefined)return this.value;
    const data=await response.json() as T&{error?:string};
    if(generation!==this.generation)return null;
    if(!response.ok)throw Object.assign(Error(data.error||'Не удалось загрузить данные'),{status:response.status});
    this.etag=response.headers.get('etag')||'';this.value=data;return data as T;
   }catch(error){if(controller.signal.aborted)return null;throw error;}
   finally{if(generation===this.generation){this.pending=undefined;this.controller=undefined;}}
  })();
  this.pending=pending;return pending;
 }
}
