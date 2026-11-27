// Runs only on the separate phone origin. CRM sessions and DOM stay on the parent origin.
const crmSites=['https://crm.smanalytics.ru','https://smcrm.ru'];
const loopback=host=>host==='localhost'||host==='127.0.0.1';
let crmOrigin='',operatorId='',phone,ready=false,used=false,ownCall,attempt,answered=false;
const send=(type,fields={})=>parent.postMessage({channel:'sm-sk-phone-v1',type,...fields},crmOrigin);
function canDial(){
  if(!ready||String(phone.getCurrentUser()?.id)!==operatorId||phone.phoneModel.get('hide_phone_numbers')!==true)return false;
  if(!['registered','ready'].includes(phone.phoneModel.get('status')))return false;
  const current=phone.phoneModel.currentCall;
  return !current||current.isEnded();
}
function reportState(){
  let message='Войдите в Скорозвон под своей учётной записью.';
  if(ready){
    if(String(phone.getCurrentUser()?.id)!==operatorId)message='Выполнен вход под другим сотрудником Скорозвона.';
    else if(phone.phoneModel.get('hide_phone_numbers')!==true)message='У этого сотрудника Скорозвона выключено скрытие телефонов.';
    else if(!['registered','ready'].includes(phone.phoneModel.get('status')))message='Ожидаем подключения телефонии. Проверьте микрофон и состояние панели.';
    else if(!canDial())message='В панели уже есть звонок.';
    else message='Телефон готов.';
  }
  send('state',{ready:canDial()&&!used,message});
}
function begin(){
  window.Tube=window.Tube||{};
  window.Tube.ready=()=>{
    try{
      phone=new window.Tube.Widgets.Phone({el:'#widget',canClose:false,waitActiveCall:true,disallowNormalStateOnActiveCall:true});
      phone.on('ready',()=>{ready=true;reportState();});
      phone.on('unauthorized',()=>{ready=false;reportState();if(attempt)finish('unknown');});
      phone.phoneModel.on('change:hide_phone_numbers',reportState);
      phone.phoneModel.on('change:status',reportState);
      for(const name of ['call:started','call:ringing','call:connected','call:ended']){
        phone.phoneModel.on(name,call=>{
          if(call===ownCall&&attempt){
            if(name==='call:connected'){answered=true;send('event',{attempt,event:'connected'});}
            if(name==='call:ended')finish(answered?'answered-end':'ended');
          }
          reportState();
        });
      }
      phone.show();reportState();
    }catch{send('state',{ready:false,message:'Не удалось открыть панель Скорозвона.'});}
  };
  const script=document.createElement('script');script.src='https://widget.skorozvon.ru/phone.js';
  script.onerror=()=>send('state',{ready:false,message:'Не удалось загрузить панель Скорозвона.'});
  document.head.append(script);
}
function finish(event){
  if(attempt)send('event',{attempt,event});
  attempt=null;ownCall=null;
}
window.addEventListener('message',e=>{
  const msg=e.data;
  if(parent===window||e.source!==parent||!msg||msg.channel!=='sm-sk-phone-v1')return;
  if(!crmOrigin){
    if(msg.type!=='init'||!/^\d{1,19}$/.test(msg.operatorId)||location.search||location.hash||e.origin===location.origin||crmSites.includes(location.origin))return;
    const dev=loopback(location.hostname)&&loopback(new URL(e.origin).hostname);
    if(!crmSites.includes(e.origin)&&!dev)return;
    crmOrigin=e.origin;operatorId=msg.operatorId;begin();return;
  }
  if(e.origin!==crmOrigin||msg.type!=='dial'||used||typeof msg.attempt!=='string'||!/^\+7\d{10}$/.test(msg.number))return;
  used=true;attempt=msg.attempt;
  if(!canDial()){finish('failed');return;}
  try{
    // The SDK resolves its Deferred with the originating call object. Other calls may arrive in the same panel.
    phone.makeCall(msg.number).done(call=>{ownCall=call;}).fail(()=>finish('failed'));
  }catch{finish('unknown');}
});
