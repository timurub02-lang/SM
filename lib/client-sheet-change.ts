import {clientAssignment,clientSheet,type Client} from './crm.ts';
export function changeClientSheet(before:Client,next:Client,sheet:unknown,role:string,allowed:string[],at:string):Partial<Client>{
 if(role!=='admin')throw Error('Лист может менять только администратор');
 if(typeof sheet!=='string'||!allowed.includes(sheet))throw Error('Выберите существующий лист этой базы');
 if(sheet===clientSheet(before))return {};
 const free=!['К','ПВ'].includes(sheet);
 return {...(free?clientAssignment(next,'',at):{}),sheet,manualSheet:{sheet,at},releasedAt:'',distributedAt:'',...(free?{releasedFromOwner:before.owner||before.releasedFromOwner,returnSheet:undefined}: {})};
}
