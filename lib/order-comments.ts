import type {Order,Employee} from './crm.ts';
export function orderComments(order:Order){
 const entries=[...(order.operatorComments||[])];
 if(order.comment&&!entries.some(entry=>entry.text===order.comment))entries.push({text:order.comment});
 return entries;
}
export function appendOrderComment(order:Order,text:string,actor:Pick<Employee,'id'|'name'>,at:string){
 const value=text.trim();
 if(!value||value.length>3000)throw Error('Комментарий должен содержать от 1 до 3000 символов');
 return {comment:value,operatorComments:[...orderComments(order),{text:value,at,by:actor.id,name:actor.name}]};
}
