import type {Employee} from './crm.ts';
export type Impersonation={id:string;adminId:string;adminName:string};
export function impersonationBlocksPhone(employee:Employee|undefined|null,path:string){
 return !!employee?.impersonation&&(path==='/api/operator-state'||path.startsWith('/api/telephony')||path.startsWith('/api/oktell-'));
}

export function mayImpersonate(owner:Pick<Employee,'id'|'role'|'department'>,target:Pick<Employee,'id'|'role'|'department'>){
 return owner.id!==target.id&&(owner.role==='admin'||owner.role==='department_head'&&!!owner.department&&target.role==='operator'&&owner.department===target.department);
}
