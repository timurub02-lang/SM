import type {Employee,IncomingRequest} from './crm.ts';
export function canTransferIncoming(e:Pick<Employee,'id'|'role'>,item:Pick<IncomingRequest,'clientOwnerId'|'assigneeId'|'closedAt'|'spam'>){
 return !item.closedAt&&!item.spam&&(e.role==='admin'||e.role==='department_head'&&(!item.clientOwnerId||item.assigneeId===e.id));
}
export const incomingTransferLabel=(e:Pick<Employee,'role'>,item:Pick<IncomingRequest,'hasActiveOrder'>)=>e.role==='admin'&&item.hasActiveOrder?'Передать другому оператору':'Передать оператору';
