import {clientSheet,hasActiveOrder,orderGroup,type Client,type Employee,type Order} from './crm.ts';
export function skOrderReview(projectId:string|null|undefined,sender:Employee|undefined,client:Client|undefined,owner:Employee|undefined,orders:Order[],projectMember=false){
 const ownerLabel=client?.owner?[owner?.name,owner?.login].filter(Boolean).join(' · ')||client.owner:'';
 const activeOrders=client?orders.filter(o=>hasActiveOrder([o],client.id)):[];
 const activeOrderIds=activeOrders.map(o=>o.id);
 const reasons=[
  client?.owner&&client.owner!==sender?.id?'Клиент принадлежит другому оператору: '+ownerLabel:null,
  activeOrderIds.length?'Есть действующие заказы: '+activeOrders.map(o=>o.id+' — '+orderGroup(o).label).join(', '):null,
  !sender?'Не найден единственный активный оператор с этим ФИО Скорозвона':null,
  projectId===null&&!projectMember?'Создан не из Проекта':null,
  client&&['ЧС','ПВ'].includes(clientSheet(client))?'Клиент находится на листе '+clientSheet(client):null,
 ].filter((reason):reason is string=>!!reason);
 return {ownerLabel,ownerIsSender:!!client?.owner&&client.owner===sender?.id,activeOrderIds,reasons};
}
