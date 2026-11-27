export const sdkUrl='https://widget.skorozvon.ru/phone.js';
export const callEvents=['call:started','call:ringing','call:connected','call:ended'];

export function testCard({externalId,name,city}){
  const values=[externalId,name,city].map(v=>typeof v==='string'?v.trim():'');
  if(!values[0]||values[0].length>200||!values[1]||values[1].length>200||values[2].length>200)
    throw new Error('Укажите внешний ID и имя тестового клиента: не более 200 символов в каждом поле.');
  return {externalId:values[0],name:values[1],city:values[2]};
}

// A late event must never replace the current customer's card.
export function createCallTracker(){
  let current=null;
  const ended=new Set();
  return (name,call)=>{
    if(!callEvents.includes(name)||typeof call?.get!=='function')return null;
    const key=call.id??call.get('id')??call.cid??call;
    if(ended.has(key))return null;
    if(current&&current.key!==key)return {overlap:true};
    if(!current)current={key};
    const raw=call.get('lead_external_id');
    const externalId=typeof raw==='string'||typeof raw==='number'?String(raw):null;
    const event={name,externalId,active:name!=='call:ended'};
    if(!event.active){ended.add(key);if(ended.size>200)ended.delete(ended.values().next().value);current=null;}
    return event;
  };
}

export function mountPhone(Tube,onCall,onStatus){
  const widget=new Tube.Widgets.Phone({el:'#widget',canClose:false,waitActiveCall:true,disallowNormalStateOnActiveCall:true});
  for(const name of callEvents)widget.phoneModel.on(name,call=>onCall(name,call));
  // These lifecycle events are present in the vendor bundle inspected on 2026-11-25.
  widget.on('authorized',()=>onStatus('authorized'));
  widget.on('ready',()=>onStatus('ready'));
  widget.on('unauthorized',()=>onStatus('unauthorized'));
  widget.show();
  return widget;
}
