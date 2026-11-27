import {sdkUrl,testCard,createCallTracker,mountPhone} from './live-model.mjs';
const $=id=>document.getElementById(id);
const phases={'call:started':'Звонок начат','call:ringing':'Идёт дозвон','call:connected':'Разговор','call:ended':'Разговор завершён. Сохраните результат в панели Скорозвона.'};
const track=createCallTracker();
let card=null,lastEvent=null,active=false,loaded=false,session=false,loadingTimer;
let widget,ready=false,sessionVersion=0,configured=false,used=false,dialMessage='';
function canDial(){
  return ready&&!active&&widget?.phoneModel.get('hide_phone_numbers')===true;
}
function renderDial(){
  $('dial-test').disabled=!configured||used||!canDial();
  $('dial-status').textContent=dialMessage||(!configured?'Согласованный номер не настроен.':
    used?'Тестовая попытка уже использована.':!ready?'Для звонка войдите под тестовым оператором.':
    active?'Дождитесь завершения текущего звонка.':!canDial()?'Включите скрытие номеров у тестового оператора в Скорозвоне.':
    'Панель готова к тестовому звонку.');
}
async function setupDial(){
  try{
    const response=await fetch('/test-call',{cache:'no-store'});
    if(!response.ok)throw Error();
    const state=await response.json();configured=state.configured;used=state.claimed;
  }catch{dialMessage='Не удалось проверить настройку тестового номера.';}
  renderDial();
}
$('dial-test').addEventListener('click',async()=>{
  if(used||!configured||!canDial())return;
  const version=sessionVersion;
  used=true;dialMessage='Готовим вызов…';renderDial();
  try{
    const response=await fetch('/test-call',{method:'POST',headers:{'X-Test-Call':'1'}});
    if(!response.ok)throw Error();
    const {number}=await response.json();
    if(version!==sessionVersion||!canDial()){
      dialMessage='Состояние оператора изменилось. Набор отменён.';return;
    }
    dialMessage='Команда передана в Скорозвон. Следите за состоянием вызова.';renderDial();
    await widget.makeCall(number);
  }catch{dialMessage='Не удалось подтвердить запуск звонка. Проверьте панель Скорозвона. Повторный набор отключён.';}
  finally{renderDial();}
});
void setupDial();
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
  renderDial();
  $('call-phase').textContent=phases[name];showCard();
  const list=$('live-events');if(!list.dataset.started){list.replaceChildren();list.dataset.started='true';}
  const item=document.createElement('li');item.textContent=`${new Date().toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow'})} · ${phases[name]}`;list.prepend(item);
  while(list.children.length>30)list.lastElementChild.remove();
}
function status(value){
  sessionVersion++;
  session=value!=='unauthorized';
  ready=value==='ready';renderDial();
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
    try{
      $('connection-status').textContent='Виджет загружен. Войдите через форму Скорозвона.';
      widget=mountPhone(window.Tube,receiveCall,status);
      widget.phoneModel.on('change:hide_phone_numbers',renderDial);
      renderDial();$('load-area').hidden=true;$('session-help').hidden=false;
    }
    catch{fail('Не удалось открыть панель. Обновите страницу и попробуйте ещё раз.');}
  };
  const script=document.createElement('script');script.src=sdkUrl;script.async=true;
  script.addEventListener('error',()=>fail('Не удалось загрузить Скорозвон. Проверьте доступ к widget.skorozvon.ru и обновите страницу.'));
  loadingTimer=setTimeout(()=>{window.Tube.ready=()=>{};fail('Скорозвон не загрузился за 30 секунд. Проверьте сеть и обновите страницу.');},30000);
  document.head.append(script);
});
window.addEventListener('beforeunload',e=>{if(active||session){e.preventDefault();e.returnValue='';}});
