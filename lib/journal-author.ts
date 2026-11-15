import {AsyncLocalStorage} from 'node:async_hooks';
import type {Employee} from './crm.ts';

// Request-local identity keeps concurrent work by the real employee separate.
export const journalIdentity=new AsyncLocalStorage<Employee>();
export function journalAuthor(actor:string,actorId?:string){
 const employee=journalIdentity.getStore(),mode=employee?.impersonation;
 if(!mode||employee.id!==actorId)return {actor,actorId};
 return {delegatedById:mode.adminId,actor:(mode.ownerRole==='department_head'?'РК ':'Администратор ')+mode.adminName+' от имени '+(employee.role==='operator'?'оператора ':'сотрудника ')+employee.name,actorId};
}
