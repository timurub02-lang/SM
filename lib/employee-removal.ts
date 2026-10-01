import {clientSheet,sourceSheet,orderGroup,type Client,type Employee,type Order,type State} from './crm.ts';
export function releasedClient(c:Client,orders:Order[]):Client{
 const related=orders.filter(o=>o.clientId===c.id);
 const active=related.some(o=>['new','accepted','sent'].includes(orderGroup(o.status).id));
 const original=c.returnSheet||((clientSheet(c)!=='К'&&clientSheet(c))||(sourceSheet(c.source)||'Т1'));
 const sheet=active?'К':related.some(o=>o.status==='redeemed')?'ТК':!related.length?(c.trialReturnSheet||c.returnSheet||'Т1'):original;
 return {...c,owner:'',sheet,assignedUntil:'',assignmentStartedAt:undefined,trialUntil:undefined,trialReturnSheet:undefined,returnSheet:undefined,orderRequest:undefined};
}
export function removalPlan(s:State,actor:Employee|undefined,id:string,version:number,mode:string,targetId?:string){
 const employee=s.employees.find(e=>e.id===id);
 if(!actor||!employee)throw Error('Сотрудник не найден');
 if(actor.id===id)throw Error('Нельзя удалить собственную учётную запись');
 if(actor.role!=='admin'&&!(actor.role==='department_head'&&employee.role==='operator'&&actor.department&&actor.department===employee.department))throw Error('Можно удалять только операторов своего отдела');
 if(employee.version!==version)throw Error('Карточка сотрудника изменена. Обновите страницу');
 if(!['transfer','release'].includes(mode))throw Error('Выберите передачу или освобождение клиентов');
 const target=mode==='transfer'?s.employees.find(e=>e.id===targetId):undefined;
 if(mode==='transfer'&&(!target||target.id===id||target.role!=='operator'||!employee.department||target.department!==employee.department))throw Error('Выберите другого оператора того же отдела');
 const owned=new Set(s.clients.filter(c=>c.owner===id).map(c=>c.id));
 const clients=s.clients.filter(c=>owned.has(c.id)||c.orderRequest?.actorId===id||c.orderRequest?.manager===id).map(c=>owned.has(c.id)?target?{...c,owner:target.id,orderRequest:undefined}:releasedClient(c,s.orders):{...c,orderRequest:undefined});
 const orders=s.orders.filter(o=>owned.has(o.clientId)||o.manager===id||o.logistic===id).map(o=>({...o,...(owned.has(o.clientId)||o.manager===id?{manager:target?.id||''}:{}),...(o.logistic===id?{logistic:''}:{})}));
 return {employee,target,clients,orders};
}
