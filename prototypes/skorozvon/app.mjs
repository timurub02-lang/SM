import {clients,outcomes,initialState,transition} from './model.mjs';
const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={phone:'M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.19 19a19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.09 4.18 2 2 0 0 1 4.08 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.79a2 2 0 0 1-.45 2.11L8.05 9.89a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.33 1.83.56 2.79.69A2 2 0 0 1 22 16.92z',pause:'M9 4v16M15 4v16',transfer:'M4 12h16m-6-6 6 6-6 6',end:'M5 12h14M8 9l-3 3 3 3M16 9l3 3-3 3',play:'m8 5 11 7-11 7z'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
const stamp=at=>new Date(at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'});
const dueStamp=at=>new Date(at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',dateStyle:'short',timeStyle:'short'});
let state=initialState(),connectTimer;
function act(action){
  try{
    const previous=state;
    const focusedId=document.activeElement?.id;
    const focusedClient=document.activeElement?.dataset?.client;
    state=transition(state,action);
    if(state===previous)return;
    $('error').hidden=true;
    clearTimeout(connectTimer);
    render(previous.clientId!==state.clientId);
    const restore=focusedId?$(focusedId):focusedClient?document.querySelector(`[data-client="${focusedClient}"]`):null;
    if(restore&&!restore.disabled&&!restore.closest('[hidden]'))restore.focus();
    if(state.phase==='ringing'&&['auto','manual'].includes(state.call.kind)){
      const id=state.call.id;
      connectTimer=setTimeout(()=>act({type:'connect',id}),1100);
    }
    if(action.type==='end')$('outcome').focus();
    if(action.type==='save')$('next-call')?.focus();
    if(action.type==='start')($('accept-call')||$('end-call'))?.focus();
    if(action.type==='connect')$('end-call')?.focus();
  }catch(error){$('error').textContent=error.message;$('error').hidden=false;}
}
function render(changed=false){
  const idle=state.phase==='idle',active=state.phase==='connected',ringing=state.phase==='ringing',wrapup=state.phase==='wrapup';
  const client=clients.find(c=>c.id===state.clientId);
  $('status').value=state.status;$('status').disabled=!idle;
  $('clients').innerHTML=clients.map(c=>`<button class="client-row" data-client="${c.id}" aria-pressed="${c.id===state.clientId}" ${idle?'':'disabled'}><strong>${c.name}</strong><span>${c.city}</span></button>`).join('');
  $('card').innerHTML=client?`<div class="client-title"><div class="avatar" aria-hidden="true">${client.name.split(' ').map(x=>x[0]).join('')}</div><div><h2>${client.name}</h2><p>Тестовая карточка · ${client.id}</p></div></div><dl class="client-meta"><div><dt>Телефон-заглушка</dt><dd>${client.phone}</dd></div><div><dt>Город</dt><dd>${client.city}</dd></div></dl><p class="client-note">${client.note}</p><div class="client-footer"><span>${idle?'Можно выбрать другую карточку':'Карточка текущего тестового звонка'}</span><button id="manual-call" class="secondary" ${idle&&state.status==='available'?'':'disabled'}>${icon('phone')}Тестовый звонок</button></div>`:`<div class="client-title"><div class="avatar" aria-hidden="true">?</div><div><h2>Контакт не сопоставлен</h2><p>Тестовый входящий · без внешнего ID</p></div></div><p class="client-note">Для этого звонка нет связи с карточкой. Чужая карточка не открывается. Результат останется в истории демо без привязки к клиенту.</p>`;
  $('card').classList.toggle('changed',changed);
  $('phase').textContent=({idle:state.status==='available'?'Доступен для звонков':state.status==='dnd'?'Не беспокоить':'Перерыв',ringing:state.call?.kind==='incoming'||state.call?.kind==='unknown'?'Входящий звонок':'Идёт дозвон',connected:state.call?.held?'На удержании':'Разговор',wrapup:'Заполнение результата'})[state.phase];
  $('call-name').textContent=idle?(state.sequence?'Готовы к следующему?':'Готовы попробовать?'):(client?.name||'Неизвестный контакт');
  $('call-number').textContent=idle?'Телефонная сеть не используется':client?.phone||'Тестовый номер не сопоставлен';
  const btn=(id,label,kind='secondary',symbol,attrs='')=>`<button id="${id}" class="${kind} full" ${attrs}>${symbol?icon(symbol):''}${label}</button>`;
  $('call-controls').innerHTML=idle?(state.status==='available'?btn('next-call','Следующий тестовый звонок','primary','phone'):btn('begin','Начать демо-смену','primary','play')):ringing?(state.call.kind==='incoming'||state.call.kind==='unknown'?btn('accept-call','Принять тестовый звонок','primary','phone'):'')+btn('end-call','Завершить дозвон','danger','end'):active?btn('hold-call',state.call.held?'Продолжить разговор':'Удержание','secondary',state.call.held?'play':'pause',`aria-pressed="${state.call.held}"`)+btn('show-transfer','Перевести','secondary','transfer','aria-expanded="false" aria-controls="transfer-controls"')+btn('end-call','Завершить звонок','danger','end'):'';
  $('transfer-controls').hidden=true;
  $('result-form').hidden=!wrapup;
  if(!wrapup){$('result-form').reset();$('due-field').hidden=true;$('due').required=false;}
  for(const option of $('outcome').options)option.disabled=option.value==='Нет ответа'&&state.call?.connectedAt!=null;
  $('notice').textContent=state.notice;
  document.querySelectorAll('[data-start]').forEach(b=>b.disabled=!idle||state.status!=='available');
  $('history-count').textContent=`Сохранено: ${state.history.length}`;
  $('history').innerHTML=state.history.length?state.history.map(h=>`<article class="history-entry"><header><strong>${escape(clients.find(c=>c.id===h.clientId)?.name||'Неизвестный контакт')} · ${escape(h.outcome)}</strong><time>${stamp(h.savedAt)} МСК</time></header>${h.comment?`<p>${escape(h.comment)}</p>`:''}${h.due?`<small>Демо-перезвон: ${dueStamp(h.due)} МСК</small>`:''}${h.transfer?`<small>Имитирован перевод: ${escape(h.transfer)}</small>`:''}</article>`).join(''):'<p class="empty">Пока нет результатов.<br>Пройдите тестовый звонок и сохраните итог — он появится здесь.</p>';
  $('events').innerHTML=state.events.length?state.events.map(e=>`<li>${stamp(e.at)} МСК · ${e.name}</li>`).join(''):'<li>Тестовые события ещё не поступали.</li>';
  updateDuration();
}
function updateDuration(){const seconds=state.call?.connectedAt?Math.max(0,Math.floor(((state.call.endedAt||Date.now())-state.call.connectedAt)/1000)):0;$('duration').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
$('phone-icon').innerHTML=icon('phone');
for(const value of outcomes){const option=document.createElement('option');option.value=value;option.textContent=value;$('outcome').append(option);}
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.client)act({type:'select',id:b.dataset.client});
  if(b.dataset.start)act({type:'start',kind:b.dataset.start});
  switch(b.id){
    case 'begin':act({type:'status',value:'available'});act({type:'start',kind:'auto'});break;
    case 'next-call':act({type:'start',kind:'auto'});break;
    case 'manual-call':act({type:'start',kind:'manual'});break;
    case 'accept-call':act({type:'connect',id:state.call?.id});break;
    case 'hold-call':act({type:'hold'});break;
    case 'end-call':act({type:'end'});break;
    case 'show-transfer':$('transfer-controls').hidden=!$('transfer-controls').hidden;b.setAttribute('aria-expanded',String(!$('transfer-controls').hidden));if(!$('transfer-controls').hidden)$('transfer-target').focus();break;
    case 'transfer':act({type:'transfer',target:$('transfer-target').value});$('end-call')?.focus();break;
  }
});
$('status').addEventListener('change',e=>act({type:'status',value:e.target.value}));
$('outcome').addEventListener('change',()=>{const callback=$('outcome').value==='Перезвонить';$('due-field').hidden=!callback;$('due').required=callback;});
$('result-form').addEventListener('submit',e=>{e.preventDefault();act({type:'save',outcome:$('outcome').value,comment:$('comment').value,due:$('due').value});});
window.addEventListener('beforeunload',e=>{if(state.phase!=='idle'||state.history.length){e.preventDefault();e.returnValue='';}});
setInterval(updateDuration,1000);
render();
