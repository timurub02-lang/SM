import type {Employee} from './crm.ts';
export type Impersonation={id:string;adminId:string;adminName:string};
export function impersonationBlocksPhone(employee:Employee|undefined|null,path:string){
 return !!employee?.impersonation&&(path==='/api/operator-state'||path.startsWith('/api/telephony')||path.startsWith('/api/oktell-'));
}
