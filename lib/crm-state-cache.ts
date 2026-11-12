import type {ActivityDb} from './activity-store.ts';
import type {State} from './crm.ts';
import {initCrmChangeClock,crmChangeRevision} from './crm-change-clock.ts';
type Entry={revision:string;pending:Promise<State>;loading:boolean};
const states=new WeakMap<ActivityDb,Map<string,Entry>>();
export async function cachedCrmState(d:ActivityDb,read:()=>Promise<State>,variant='full'):Promise<State>{
 await initCrmChangeClock(d);
 let variants=states.get(d);if(!variants){variants=new Map();states.set(d,variants);}
 for(;;){
  const revision=await crmChangeRevision(d),saved=variants.get(variant);
  if(saved?.revision===revision)return {...await saved.pending};
  // A changed revision must not start another full read while the previous one still owns its rows.
  if(saved?.loading){await saved.pending;continue;}
  const entry:Entry={revision,pending:read(),loading:true};variants.set(variant,entry);
  try{return {...await entry.pending};}
  catch(error){if(variants.get(variant)===entry)variants.delete(variant);throw error;}
  finally{entry.loading=false;}
 }
}
