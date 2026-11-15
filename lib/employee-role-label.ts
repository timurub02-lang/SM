import {roles,type Employee} from './crm.ts';
import {isEmil} from './partner-cash.ts';
export const employeeRoleGroup=(e:Pick<Employee,'login'|'role'>)=>isEmil(e)?'partner':e.role;
export const employeeRoleLabel=(e:Pick<Employee,'login'|'role'>)=>isEmil(e)?'Партнёр':roles[e.role];
