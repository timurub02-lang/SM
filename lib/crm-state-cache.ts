import type {ActivityDb} from './activity-store.ts';
import type {State} from './crm.ts';
import {initCrmChangeClock,crmChangeRevision} from './crm-change-clock.ts';
const states=new WeakMap<ActivityDb,Map<string,{revision:string;pending:Promise<State>}>>();
export async function cachedCrmState(d:ActivityDb,read:()=>Promise<State>,variant='full'):Promise<State>{
 await initCrmChangeClock(d);const revision=await crmChangeRevision(d);
 let variants=states.get(d);if(!variants){variants=new Map();states.set(d,variants);}const saved=variants.get(variant);
 if(saved?.revision===revision)return {...await saved.pending};
 const entry={revision,pending:read()};variants.set(variant,entry);
 try{return {...await entry.pending};}catch(error){if(variants.get(variant)===entry)variants.delete(variant);throw error;}
}
