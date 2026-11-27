// Synthetic operator flow. No credentials, provider transport, CRM API or database.
export const clients = [
  {id:'demo-101',name:'Анна Миронова',city:'Казань',phone:'+7 (000) 000-01-01',note:'Просила рассказать о доставке и условиях заказа.'},
  {id:'demo-102',name:'Михаил Орлов',city:'Самара',phone:'+7 (000) 000-01-02',note:'Удобно разговаривать во второй половине дня.'},
  {id:'demo-103',name:'Елена Волкова',city:'Пермь',phone:'+7 (000) 000-01-03',note:'Хочет уточнить состав и наличие товара.'},
];
export const outcomes = ['Интерес есть','Перезвонить','Не заинтересован','Нет ответа'];
export const initialState = () => ({status:'break',phase:'idle',clientId:clients[0].id,call:null,history:[],events:[],notice:'Начните демо-смену, чтобы получить первый тестовый звонок.',sequence:0});
const requireThat=(ok,message)=>{if(!ok)throw new Error(message);};
const event=(s,name,now)=>({...s,events:[{name,at:now},...s.events].slice(0,30)});
export function transition(s,a,now=Date.now()) {
  switch(a.type){
    case 'status':
      requireThat(['available','break','dnd'].includes(a.value),'Неизвестный статус.');
      requireThat(s.phase==='idle','Сначала завершите звонок и сохраните результат.');
      return {...s,status:a.value,notice:a.value==='available'?'Готовы к тестовым звонкам.':'Новые тестовые звонки приостановлены.'};
    case 'select':
      requireThat(s.phase==='idle','Карточка закреплена за текущим звонком.');
      requireThat(clients.some(c=>c.id===a.id),'Тестовый клиент не найден.');
      return {...s,clientId:a.id};
    case 'start': {
      requireThat(s.status==='available'&&s.phase==='idle','Сначала выберите «Доступен» и сохраните предыдущий результат.');
      requireThat(['auto','manual','incoming','unknown'].includes(a.kind),'Неизвестный сценарий.');
      const clientId=a.kind==='unknown'?null:a.kind==='manual'?s.clientId:clients[s.sequence%clients.length].id;
      requireThat(a.kind!=='manual'||clientId,'Выберите клиента для ручного звонка.');
      const next={...s,clientId,sequence:s.sequence+1,phase:'ringing',call:{id:`demo-call-${s.sequence+1}`,kind:a.kind,clientId,startedAt:now,connectedAt:null,endedAt:null,held:false,transfer:null},notice:a.kind==='incoming'||a.kind==='unknown'?'Тестовый входящий. Нажмите «Принять».':'Тестовый дозвон. Соединение появится через секунду.'};
      return event(event(next,'call:started',now),'call:ringing',now);
    }
    case 'connect':
      if(s.phase!=='ringing'||s.call?.id!==a.id)return s;
      return event({...s,phase:'connected',call:{...s.call,connectedAt:now},notice:'Демо-разговор. Микрофон и телефонная сеть не используются.'},'call:connected',now);
    case 'hold':
      requireThat(s.phase==='connected','Удержание доступно во время разговора.');
      return {...s,call:{...s.call,held:!s.call.held},notice:s.call.held?'Демо-разговор продолжен.':'Демо-удержание. В реальном виджете клиент слышит музыку.'};
    case 'transfer':
      requireThat(s.phase==='connected','Перевод доступен во время разговора.');
      requireThat(['Тестовый сотрудник','Тестовая группа'].includes(a.target),'Выберите получателя перевода.');
      return {...s,call:{...s.call,transfer:a.target},notice:`Демо: перевод на «${a.target}» запрошен. Завершите звонок для заполнения результата.`};
    case 'end':
      requireThat(['ringing','connected'].includes(s.phase),'Нет активного звонка.');
      return event({...s,phase:'wrapup',call:{...s.call,held:false,endedAt:now},notice:'Разговор завершён. Сохраните результат перед следующим звонком.'},'call:ended',now);
    case 'save': {
      requireThat(s.phase==='wrapup','Сначала завершите звонок.');
      requireThat(outcomes.includes(a.outcome),'Выберите результат разговора.');
      requireThat(typeof a.comment==='string'&&a.comment.length<=1000,'Комментарий должен быть не длиннее 1000 символов.');
      requireThat(a.outcome!=='Нет ответа'||s.call.connectedAt===null,'После соединения выберите результат разговора.');
      const due=a.outcome==='Перезвонить'?Date.parse(a.due+':00+03:00'):null;
      requireThat(a.outcome!=='Перезвонить'||(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(a.due||'')&&Number.isFinite(due)&&due>now),'Выберите будущее время перезвона по Москве.');
      const entry={...s.call,outcome:a.outcome,comment:a.comment.trim(),due,savedAt:now};
      return {...s,phase:'idle',call:null,history:[entry,...s.history],notice:'Результат сохранён в памяти прототипа. Можно получить следующий тестовый звонок.'};
    }
    default: throw new Error('Неизвестное действие.');
  }
}

// Documented Backbone call events, pages 61–62. This binding never loads the vendor SDK.
export function bindDocumentedEvents(phoneModel,onEvent){
  const names=['call:started','call:ringing','call:connected','call:ended'];
  const handlers=names.map(name=>[name,call=>onEvent({name,externalId:call.get('lead_external_id')??null})]);
  for(const [name,handler] of handlers)phoneModel.on(name,handler);
  return ()=>{for(const [name,handler] of handlers)phoneModel.off(name,handler);};
}
