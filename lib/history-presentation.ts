// Existing events remain intact; only their presentation is shortened.
export function historyPresentation(text:string){
 const lines=(text||'').split('\n');
 const changeStart=lines.findIndex((line,index)=>index>0&&/^[^:]+: .* → /.test(line));
 const heading=changeStart<0?(/→ Возврат оператору/.test(lines[0])?text:lines[0]):lines.slice(0,changeStart).join('\n');
 const fields=changeStart<0?[]:lines.slice(changeStart).filter(line=>/^[^:]+: .* → /.test(line)).map(line=>line.slice(0,line.indexOf(':')));
 let summary=heading;
 if(/^(Сохранены данные заказа|Обновлены доставка, адрес, корзина|Логист уточнил данные заказа)/.test(heading)&&fields.length){
  const names=[...new Set(fields.map(field=>({Адрес:'адрес','Поля адреса':'адрес',Корзина:'корзина','Способ доставки':'способ доставки','ПВЗ получателя':'ПВЗ','Комментарии оператора':'комментарий оператора','Комментарий оператора':'комментарий оператора','Комментарий логиста':'комментарий логиста'} as Record<string,string>)[field]||field.toLocaleLowerCase('ru')))];
  summary='Изменения заказа: '+names.join(', ');
 }
 // Return reasons stay in the heading, including multiline comments before the diff.
 if(/→ Возврат оператору/.test(heading))summary=heading;
 return {summary,details:text!==summary?text:''};
}
