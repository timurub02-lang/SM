import type {Employee} from './crm.ts';
export type OktellLink={requested:boolean;status:'pending'|'linked'|'error';login:string;requestId:string;requestedAt:string;requestedBy:string;userId?:string;linkedAt?:string;error?:string};
export function prepareOktellLink(actor:Employee|undefined,employee:{login:string;role:string},existing:Employee|undefined,requested:unknown,now=new Date()):OktellLink|undefined{
 const old=existing?.oktell;
 if(old&&(old.userId||old.status==='pending')&&employee.login!==old.login)throw Error('Сначала согласуйте смену связанного логина Oktell; текущий логин менять нельзя');
 if(requested!==undefined&&typeof requested!=='boolean')throw Error('Неверное значение переключателя Oktell');
 if(actor?.role!=='admin'){if(requested!==undefined&&requested!==!!old?.requested)throw Error('Связь с Oktell настраивает администратор');return old;}
 if(requested===undefined)return old;
 if(!requested)return old?{...old,requested:false}:undefined;
 if(employee.role!=='operator')throw Error('Создание в Oktell доступно для роли «Оператор»');
 if(!/^[A-Za-z0-9_.@-]{1,50}$/.test(employee.login))throw Error('Для Oktell используйте логин до 50 символов: латинские буквы, цифры, точка, _, @ или дефис');
 if(old?.userId||old?.status==='pending'&&old.requested)return {...old,requested:true};
 return {requested:true,status:'pending',login:employee.login,requestId:crypto.randomUUID(),requestedAt:now.toISOString(),requestedBy:actor.id};
}
