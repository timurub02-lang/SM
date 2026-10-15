import {createHmac} from 'node:crypto';
export const phoneRoles=['admin','operator','department_head','logistic','chief_logistic','redemption'];
export function phoneAccount(id:string){
 const key=process.env.CRM_PHONE_RESULT_KEY;
 if(!key||key.length<32)throw Error('Телефония ещё не подключена');
 const digest=(kind:string)=>createHmac('sha256',key).update(kind+':'+id).digest('hex');
 return {username:'crm-'+digest('username').slice(0,24),password:digest('password')};
}
