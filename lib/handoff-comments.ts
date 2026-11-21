import type {Event} from './crm.ts';

// Older transitions store the entered reason in the event heading, before the field changes.
export function handoffComment(text:string){
 const heading=text.split(/\nСтатус: /,1)[0].replace(/^(?:Подтверждено руководителем · [^\n]+? · )?(?:ЗВД снят · )?/,'');
 const match=/^(?:(?:Оформление|Возврат оператору) → (?:Подтверждение|Доп\. подтверждение)|(?:Доп\. подтверждение|Подтверждение|Проверка|Упаковка) → Возврат оператору · (?:Уточнить данные \/ связаться с клиентом|Отработать отказ клиента|Смена доставки)) · ([\s\S]+)$/.exec(heading);
 if(!match)return '';
 return match[1].split(/(?:^| · )(?:ФИО:|Комментарий логиста:|Трек-номер:|Заметка в историю:|Выбран ПВЗ:|Способ доставки изменён:|Стоимость доставки:)/,1)[0].trim();
}

export function handoffEntries(events:Event[]){
 return events.flatMap(e=>{const text=handoffComment(e.text);return text?[{id:e.id,actor:e.actor,at:e.at,text}]:[];});
}

export function previousHandoffComments(comments:ReturnType<typeof handoffEntries>,currentReason:string){
 return comments[0]?.text===currentReason.trim()?comments.slice(1):comments;
}
