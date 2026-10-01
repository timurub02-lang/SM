import {hideClientPhone} from './crm.ts';
export function journalAction(text:string,role:string){
 if(!hideClientPhone(role))return text;
 // Free-form notes and SMS bodies may contain a client's phone number.
 if(text.startsWith('Комментарий:'))return 'Добавлен комментарий';
 if(text.startsWith('Недозвон:'))return 'Зафиксирован недозвон';
 if(text.startsWith('Перезвон:'))return 'Назначен перезвон';
 const action=text.split(' · ')[0];
 return action.replace(/\+?\d[\d\s().-]{8,}\d/g,'[номер скрыт]');
}
