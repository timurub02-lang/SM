import {sdkUrl,testCard,createCallTracker,mountPhone} from './live-model.mjs';
const $=id=>document.getElementById(id);
const phases={'call:started':'Звонок начат','call:ringing':'Идёт дозвон','call:connected':'Разговор','call:ended':'Разговор завершён. Сохраните результат в панели Скорозвона.'};
const track=createCallTracker();
let card=null,lastEvent=null,active=false,loaded=false,session=false,loadingTimer;
function showCard(){
  const match=card&&lastEvent?.externalId===card.externalId;
  $('live-card').hidden=!match;
  $('card-heading').textContent=!lastEvent?'Ожидаем звонок':match?card.name:'Контакт не сопоставлен';
  $('card-state').textContent=!lastEvent?'Карточка откроется по событию звонка.':match?'Локальная тестовая карточка совпала по внешнему ID.':lastEvent.externalId?'Внешний ID звонка не совпадает с тестовой карточкой.':'Скорозвон не передал внешний ID. Карточка не привязана.';
  for(const [id,value] of [['card-name',match?card.name:''],['card-city',match?card.city||'Не указан':''],['card-id',match?card.externalId:'']])$(id).textContent=value;
}
$('mapping-form').addEventListener('submit',e=>{
  e.preventDefault();if(active)return;
  try{card=testCard(Object.fromEntries(new FormData(e.target)));$('mapping-status').textContent='Карточка готова. Ожидаем точное совпадение внешнего ID.';showCard();}
  catch(error){$('mapping-status').textContent=error.message;}
});
function receiveCall(name,call){
  const event=track(name,call);if(!event)return;
  if(event.overlap){$('live-error').hidden=false;$('live-error').textContent='Получено событие другого звонка. Карточка закреплена за текущим разговором; проверьте панель Скорозвона.';return;}
  lastEvent=event;active=event.active;$('mapping-fields').disabled=active;
  $('call-phase').textContent=phases[name];showCard();
  const list=$('live-events');if(!list.dataset.started){list.replaceChildren();list.dataset.started='true';}
  const item=document.createElement('li');item.textContent=`${new Date().toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow'})} · ${phases[name]}`;list.prepend(item);
  while(list.children.length>30)list.lastElementChild.remove();
}
function status(value){
  session=value!=='unauthorized';
  $('connection-status').textContent=({authorized:'Вход выполнен. Скорозвон подключает телефонию…',ready:'Панель подключена. Проверьте статус и проект оператора.',unauthorized:'Вход не выполнен. Используйте форму Скорозвона.'})[value];
  if(value==='unauthorized'&&!active){lastEvent=null;showCard();}
}
function fail(message){clearTimeout(loadingTimer);$('live-error').textContent=message;$('live-error').hidden=false;$('connection-status').textContent='Панель не готова.';$('load-widget').disabled=true;}
$('load-widget').addEventListener('click',()=>{
  if(loaded)return;loaded=true;$('load-widget').disabled=true;
  $('connection-status').textContent='Загружаем виджет с widget.skorozvon.ru…';
  // The vendor loader reads query parameters as configuration. Do not accept overrides.
  if(location.search||location.hash){fail('Откройте адрес страницы без параметров и обновите её.');return;}
  window.Tube=window.Tube||{};
  window.Tube.ready=()=>{
    clearTimeout(loadingTimer);
    try{mountPhone(window.Tube,receiveCall,status);$('load-area').hidden=true;$('session-help').hidden=false;$('connection-status').textContent='Виджет загружен. Войдите через форму Скорозвона.';}
    catch{fail('Не удалось открыть панель. Обновите страницу и попробуйте ещё раз.');}
  };
  const script=document.createElement('script');script.src=sdkUrl;script.async=true;
  script.addEventListener('error',()=>fail('Не удалось загрузить Скорозвон. Проверьте доступ к widget.skorozvon.ru и обновите страницу.'));
  loadingTimer=setTimeout(()=>{window.Tube.ready=()=>{};fail('Скорозвон не загрузился за 30 секунд. Проверьте сеть и обновите страницу.');},30000);
  document.head.append(script);
});
window.addEventListener('beforeunload',e=>{if(active||session){e.preventDefault();e.returnValue='';}});
