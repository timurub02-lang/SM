const key='crm-account-change';

export function notifyAccountChange(){
 try{localStorage.setItem(key,crypto.randomUUID());}catch{/* Focus checks also work without storage. */}
}

export function watchAccount(employeeId:string,impersonationId:string|undefined){
 let checking=false,disposed=false;
 const reload=()=>window.location.reload();
 const storage=(event:StorageEvent)=>{if(event.key===key)reload();};
 const verify=async()=>{
  if(document.hidden||checking)return;
  checking=true;
  try{
   const response=await fetch('/api/auth/me',{cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(disposed)return;
   if(response.status===401){window.location.replace('/login');return;}
   if(!response.ok)return;
   const account=await response.json() as {employee?:{id:string};impersonation?:{id:string}|null};
   if(!disposed&&(account.employee?.id!==employeeId||account.impersonation?.id!==impersonationId))reload();
  }catch{/* Retry on the next focus or visibility change. */}
  finally{checking=false;}
 };
 window.addEventListener('storage',storage);
 window.addEventListener('focus',verify);
 window.addEventListener('pageshow',verify);
 document.addEventListener('visibilitychange',verify);
 void verify();
 return ()=>{
  disposed=true;
  window.removeEventListener('storage',storage);
  window.removeEventListener('focus',verify);
  window.removeEventListener('pageshow',verify);
  document.removeEventListener('visibilitychange',verify);
 };
}
