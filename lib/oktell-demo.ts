// This model is intentionally disconnected from CRM persistence and all telephony APIs.
export type DemoClient={id:string;name:string;base:'М'|'Ж';sheet:string;owner:string;state:'free'|'queued'|'talking'|'done'|'callback';project:string;result:string};
export type DemoProject={id:string;name:string;base:'М'|'Ж';leader:string;operators:string[]};
export type DemoCall={id:string;clientId:string;operator:string;project:string;result:string;note:string;callback:string;order:string;kind:'auto'|'manual'};
export type DemoState={clients:DemoClient[];calls:DemoCall[];active:string;operator:string;ready:boolean;kind:'auto'|'manual'};
export const demoProjects:DemoProject[]=[
 {id:'demo-m',name:'М · Т1 · учебный',base:'М',leader:'Руководитель М · демо',operators:['Анна · демо','Игорь · демо']},
 {id:'demo-j',name:'Ж · Т1 · учебный',base:'Ж',leader:'Руководитель Ж · демо',operators:['Елена · демо','Олег · демо']},
];
export const demoRows=[
 ['DEMO-0001','Клиент 01','М','Т1',''],['DEMO-0002','Клиент 02','М','П',''],
 ['DEMO-0003','Клиент 03','Ж','Т1',''],['DEMO-0004','Клиент 04','Ж','Т1',''],
 ['DEMO-0005','Клиент 05','М','К','Анна · демо'],['DEMO-0006','Клиент 06','М','ЧС',''],
 ['DEMO-0007','Клиент 07','Ж','ПВ',''],['DEMO-0001','Дубль клиента 01','М','Т1',''],
 ['ошибка','Некорректная строка','М','Т1',''],
];
export function emptyDemo():DemoState{return {clients:[],calls:[],active:'',operator:'Анна · демо',ready:false,kind:'auto'};}
export function checkDemoRows(rows:unknown[][],existing:DemoClient[]=[]){
 const seen=new Set(existing.map(c=>c.id));const accepted:DemoClient[]=[];const issues:{row:number;reason:string}[]=[];
 rows.forEach((r,i)=>{const [rawId,rawName,rawBase,rawSheet,rawOwner]=r;const id=String(rawId??'').trim().toUpperCase();
  if(!/^DEMO-\d{4}$/.test(id)){issues.push({row:i+2,reason:'Разрешены только учебные коды DEMO-0001; настоящие телефоны не принимаются'});return;}
  if(seen.has(id)){issues.push({row:i+2,reason:'Дубль учебного клиента'});return;}
  const base=String(rawBase??'').trim();const sheet=String(rawSheet??'').trim();
  if(!['М','Ж'].includes(base)||!['К','П','ЧС','ПВ','Т1','Т2'].includes(sheet)){issues.push({row:i+2,reason:'Проверьте базу М/Ж и лист'});return;}
  seen.add(id);accepted.push({id,name:String(rawName||id).slice(0,80),base:base as 'М'|'Ж',sheet,owner:String(rawOwner||'').slice(0,80),state:'free',project:'',result:''});
 });return {accepted,issues};
}
export function demoBlock(c:DemoClient){return ['К','ЧС','ПВ'].includes(c.sheet)?'Лист '+c.sheet+' исключён из массового обзвона':c.owner?'Закреплён за оператором':c.state!=='free'?'Уже выдан или обработан':'';}
export function queueDemo(s:DemoState,project:DemoProject,count:number):DemoState{
 if(!Number.isInteger(count)||count<1||count>100)throw Error('Выберите от 1 до 100 клиентов');
 let left=count;const clients=s.clients.map(c=>c.base===project.base&&!demoBlock(c)&&left-->0?{...c,state:'queued' as const,project:project.id}:c);
 return {...s,clients};
}
export function connectDemo(s:DemoState,project:DemoProject,operator:string,manualId=''):DemoState{
 if(s.active)throw Error('Сначала сохраните результат текущего разговора');
 if(!project.operators.includes(operator))throw Error('Оператор не входит в команду проекта');
 if(!manualId&&!s.ready)throw Error('Сначала нажмите «Готов к звонкам»');
 const c=manualId?s.clients.find(c=>c.id===manualId):s.clients.find(c=>c.project===project.id&&c.state==='queued');
 if(!c)throw Error('В очереди пока нет клиентов');
 if(manualId&&(!s.calls.some(x=>x.clientId===c.id&&x.order)||c.owner!==operator||c.state==='queued'||c.state==='talking'))throw Error('Ручной звонок доступен по своему учебному заказу без активного задания');
 if(['ЧС','ПВ'].includes(c.sheet)||!manualId&&(c.owner||c.sheet==='К'))throw Error('Клиент больше не доступен для обзвона');
 return {...s,active:c.id,operator,kind:manualId?'manual':'auto',clients:s.clients.map(x=>x.id===c.id?{...x,state:'talking'}:x)};
}
export function finishDemo(s:DemoState,result:string,note:string,callback:string):DemoState{
 if(!s.active)throw Error('Нет учебного разговора');
 if(!['Заказ','Перезвон','Отказ','Нет ответа'].includes(result))throw Error('Выберите результат');
 if(result==='Перезвон'&&(!callback||!Number.isFinite(Date.parse(callback))||Date.parse(callback)<=Date.now()))throw Error('Выберите будущее время перезвона');
 const c=s.clients.find(x=>x.id===s.active)!;const previous=s.calls.find(x=>x.clientId===c.id&&x.order)?.order;
 const order=result==='Заказ'?(previous||'DEMO-ORDER-'+String(s.calls.length+1).padStart(3,'0')):'';
 return {...s,active:'',calls:[...s.calls,{id:'DEMO-CALL-'+(s.calls.length+1),clientId:c.id,operator:s.operator,project:c.project,result,note:note.slice(0,500),callback:result==='Перезвон'?callback:'',order,kind:s.kind}],clients:s.clients.map(x=>x.id===c.id?{...x,state:result==='Перезвон'?'callback':'done',result,owner:order?s.operator:x.owner,sheet:order?'К':x.sheet}:x)};
}
