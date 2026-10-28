import type {Employee} from './crm';

export function hasOktellLink(employee:Employee|null|undefined):boolean{
 return employee?.role==='operator'&&employee.oktell?.requested===true&&employee.oktell.status==='linked'&&!!employee.oktell.userId&&!!employee.oktell.login;
}
