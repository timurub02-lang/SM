import type {Employee} from './crm.ts';

export type HeadVacation = {
 substitute: string;
 department: NonNullable<Employee['department']>;
 substituteDepartment: NonNullable<Employee['department']>;
 from: string;
 until: string;
 enabled: boolean;
};
export const moscowWorkDay=(now=Date.now())=>new Date(now+3*3600000).toISOString().slice(0,10);
type Head=Pick<Employee,'role'|'department'>&Partial<Pick<Employee,'id'>>;
export function coversHead(viewer:Head,head:Employee,day=moscowWorkDay()){
 const v=head.vacation;
 return !!v&&head.role==='department_head'&&v.department===head.department&&viewer.role==='department_head'&&v.substitute===viewer.id&&v.substituteDepartment===viewer.department&&v.from<=day&&day<=v.until;
}
export function managesWorkDepartment(viewer:Head,department:string|undefined,staff:Employee[]){
 return !!department&&viewer.role==='department_head'&&(department===viewer.department||
  staff.some(head=>head.department===department&&head.vacation?.enabled&&coversHead(viewer,head)));
}
