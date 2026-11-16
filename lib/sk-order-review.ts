import {clientSheet,hasActiveOrder,type Client,type Employee,type Order} from './crm.ts';
export function skOrderReview(projectId:string|null|undefined,sender:Employee|undefined,client:Client|undefined,owner:Employee|undefined,orders:Order[]){
 const ownerLabel=client?.owner?[owner?.name,owner?.login].filter(Boolean).join(' · ')||client.owner:'';
 const activeOrderIds=client?orders.filter(o=>hasActiveOrder([o],client.id)).map(o=>o.id):[];
 const reasons=[
  client?.owner&&client.owner!==sender?.id?'Клиент принадлежит другому оператору: '+ownerLabel:null,
  activeOrderIds.length?'Есть действующие заказы: '+activeOrderIds.join(', '):null,
  !sender?'Не найден единственный активный оператор с этим ФИО Скорозвона':null,
  projectId===null?'Создан не из Проекта':null,
  client&&['ЧС','ПВ'].includes(clientSheet(client))?'Клиент находится на листе '+clientSheet(client):null,
 ].filter((reason):reason is string=>!!reason);
 return {ownerLabel,activeOrderIds,reasons};
}
