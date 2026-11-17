import type {Employee} from './crm.ts';
export const incomingWorkRoles=['operator','department_head','logistic','chief_logistic','redemption'];
export const incomingWorkMessage='Обработайте входящие обращения, чтобы продолжить работу в CRM';
export type IncomingWorkGate={incomingIds:string[];clientIds:string[];orderIds:string[];skOrders:{id:string;clientId:string}[]};
export const emptyIncomingWorkGate=():IncomingWorkGate=>({incomingIds:[],clientIds:[],orderIds:[],skOrders:[]});
export const incomingWorkApplies=(e:Pick<Employee,'role'>)=>incomingWorkRoles.includes(e.role);
export function incomingWorkTarget(g:IncomingWorkGate,type:'client'|'order',id:string){
 return (type==='client'?g.clientIds:g.orderIds).includes(id)||type==='order'&&g.skOrders.some(o=>o.id===id);
}
