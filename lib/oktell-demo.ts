// This model is intentionally disconnected from CRM persistence and all telephony APIs.
export type DemoClient={id:string;name:string;base:'М'|'Ж';sheet:string;owner:string;state:'free'|'queued'|'talking'|'done'|'callback';project:string;result:string;attempts:number;nextAt:number;utcOffset:number;callbackOperator:string};
export type DemoProject={id:string;name:string;base:'М'|'Ж';leader:string;operators:string[]};
export type DemoCall={id:string;clientId:string;operator:string;project:string;result:string;note:string;callback:string;order:string;kind:'auto'|'manual';at:number;callerId:string;trunk:string};
export type DemoState={clients:DemoClient[];calls:DemoCall[];active:string;operator:string;ready:boolean;kind:'auto'|'manual';now:number;settings:Record<string,ProjectSettings>;presence:Record<string,boolean>;activeCaller:string};
export const demoProjects:DemoProject[]=[
 {id:'demo-m',name:'М · Т1 · учебный',base:'М',leader:'Руководитель М · демо',operators:['Анна · демо','Игорь · демо']},
 {id:'demo-j',name:'Ж · Т1 · учебный',base:'Ж',leader:'Руководитель Ж · демо',operators:['Елена · демо','Олег · демо']},
 {id:'demo-m-return',name:'М · повторные · учебный',base:'М',leader:'Руководитель М · демо',operators:['Анна · демо','Игорь · демо']},
];
export const demoRows=[
 ['DEMO-0001','Клиент 01','М','Т1',''],['DEMO-0002','Клиент 02','М','П',''],
 ['DEMO-0003','Клиент 03','Ж','Т1',''],['DEMO-0004','Клиент 04','Ж','Т1',''],
 ['DEMO-0005','Клиент 05','М','К','Анна · демо'],['DEMO-0006','Клиент 06','М','ЧС',''],
 ['DEMO-0007','Клиент 07','Ж','ПВ',''],['DEMO-0001','Дубль клиента 01','М','Т1',''],
 ['ошибка','Некорректная строка','М','Т1',''],
];
export function emptyDemo():DemoState{return {clients:[],calls:[],active:'',operator:'Анна · демо',ready:false,kind:'auto',now:Date.parse('2026-10-22T11:00:00+03:00'),settings:Object.fromEntries(demoProjects.map(p=>[p.id,defaultSettings(p)])),presence:{},activeCaller:''};}
export function checkDemoRows(rows:unknown[][],existing:DemoClient[]=[]){
 const seen=new Set(existing.map(c=>c.id));const accepted:DemoClient[]=[];const issues:{row:number;reason:string}[]=[];
 rows.forEach((r,i)=>{const [rawId,rawName,rawBase,rawSheet,rawOwner]=r;const id=String(rawId??'').trim().toUpperCase();
  if(!/^DEMO-\d{4}$/.test(id)){issues.push({row:i+2,reason:'Разрешены только учебные коды DEMO-0001; настоящие телефоны не принимаются'});return;}
  if(seen.has(id)){issues.push({row:i+2,reason:'Дубль учебного клиента'});return;}
  const base=String(rawBase??'').trim();const sheet=String(rawSheet??'').trim();
  if(!['М','Ж'].includes(base)||!['К','П','ЧС','ПВ','Т1','Т2'].includes(sheet)){issues.push({row:i+2,reason:'Проверьте базу М/Ж и лист'});return;}
  seen.add(id);accepted.push({id,name:String(rawName||id).slice(0,80),base:base as 'М'|'Ж',sheet,owner:String(rawOwner||'').slice(0,80),state:'free',project:'',result:'',attempts:0,nextAt:0,utcOffset:base==='М'?3:7,callbackOperator:''});
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
 if(!s.settings[project.id].operators.includes(operator))throw Error('Оператор не включён в проект');
 if(!manualId&&!s.ready)throw Error('Сначала нажмите «Готов к звонкам»');
 if(!manualId&&projectBlock(s,project))throw Error(projectBlock(s,project));
 const c=manualId?s.clients.find(c=>c.id===manualId):readyClients(s,project,operator)[0];
 if(!c)throw Error('Нет доступных клиентов: проверьте время, повторы и очередь');
 if(manualId&&(!s.calls.some(x=>x.clientId===c.id&&x.order)||c.owner!==operator||['queued','talking','callback'].includes(c.state)))throw Error('Ручной звонок доступен по своему учебному заказу без активного задания');
 if(['ЧС','ПВ'].includes(c.sheet))throw Error('Клиент больше не доступен для обзвона');
 return {...s,active:c.id,operator,kind:manualId?'manual':'auto',activeCaller:callerId(s,project),presence:{...s.presence,[operator]:true},clients:s.clients.map(x=>x.id===c.id?{...x,state:'talking',project:project.id,attempts:x.attempts+1}:x)};
}
export function finishDemo(s:DemoState,result:string,note:string,callback:string):DemoState{
 if(!s.active)throw Error('Нет учебного разговора');
 if(!['Заказ','Перезвон','Отказ',...retryResults].includes(result))throw Error('Выберите результат');
 const callbackAt=callback?Date.parse(callback+'+03:00'):NaN;
 if(result==='Перезвон'&&(!Number.isFinite(callbackAt)||callbackAt<=s.now))throw Error('Выберите время позже учебных часов (МСК)');
 const c=s.clients.find(x=>x.id===s.active)!;const previous=s.calls.find(x=>x.clientId===c.id&&x.order)?.order;
 const order=result==='Заказ'?(previous||'DEMO-ORDER-'+String(s.calls.length+1).padStart(3,'0')):'';
 const cfg=s.settings[c.project];
 let updated:DemoClient={...c,state:'done',result,nextAt:0,owner:order?s.operator:c.owner,sheet:order?'К':c.sheet};
 if(result==='Перезвон')updated={...updated,state:'callback',nextAt:callbackAt,callbackOperator:s.operator};
 const rule=cfg.rules[result as RetryResult];
 if(rule&&s.kind==='auto'&&c.attempts<cfg.maxAttempts){
  if(rule.action==='retry')updated={...updated,state:'queued',nextAt:s.now+rule.minutes*60000};
  if(rule.action==='transfer'&&demoProjects.some(p=>p.id===rule.target&&p.base===c.base&&p.id!==c.project))updated={...updated,state:'queued',project:rule.target,nextAt:s.now+rule.minutes*60000};
 }
 return {...s,active:'',activeCaller:'',calls:[...s.calls,{id:'DEMO-CALL-'+(s.calls.length+1),clientId:c.id,operator:s.operator,project:c.project,result,note:note.slice(0,500),callback:result==='Перезвон'?callback:'',order,kind:s.kind,at:s.now,callerId:s.activeCaller,trunk:cfg.trunk}],clients:s.clients.map(x=>x.id===c.id?updated:x)};
}
export function saveProject(s:DemoState,p:DemoProject,cfg:ProjectSettings):DemoState{
 if(s.active)throw Error('Завершите учебный разговор перед изменением настроек');
 validateSettings(cfg,p,demoProjects);
 return {...s,settings:{...s.settings,[p.id]:structuredClone(cfg)}};
}
export function demoShift():DemoState{
 let s=emptyDemo();s.clients=checkDemoRows(demoRows).accepted;
 for(let i=8;i<=18;i++)s.clients.push({id:'DEMO-'+String(i).padStart(4,'0'),name:'Клиент '+i,base:i%2?'Ж':'М',sheet:'Т1',owner:'',state:'free',project:'',result:'',attempts:0,nextAt:0,utcOffset:i%3===0?10:3,callbackOperator:''});
 s=queueDemo(s,demoProjects[0],100);s=queueDemo(s,demoProjects[1],100);
 s={...s,ready:true,presence:{'Анна · демо':true,'Елена · демо':true}};
 s=connectDemo(s,demoProjects[0],'Анна · демо');s=finishDemo(s,'Заказ','Учебная продажа','');
 s=connectDemo(s,demoProjects[0],'Анна · демо');s=finishDemo(s,'Нет ответа','Повтор по правилам проекта','');
 s=connectDemo(s,demoProjects[1],'Елена · демо');s=finishDemo(s,'Перезвон','Клиент попросил позвонить позже',localClock(s.now+3600000));
 return connectDemo(s,demoProjects[0],'Анна · демо');
}


export const retryResults=['Нет ответа','Занято','Автоответчик','Ошибка'] as const;
export type RetryResult=typeof retryResults[number];
export type ResultRule={action:'retry'|'finish'|'transfer';minutes:number;target:string};
export type ProjectSettings={running:boolean;mode:'predictive'|'progressive';operators:string[];days:number[];start:string;end:string;clientStart:string;clientEnd:string;maxAttempts:number;ringSeconds:number;channels:number;trunk:'demo-m'|'demo-j';rotation:'cycle'|'fixed';order:'attempts'|'east';rules:Record<RetryResult,ResultRule>};
export const demoTrunks={
 'demo-m':{name:'Учебный транк М',numbers:['DEMO-M-01','DEMO-M-02','DEMO-M-03']},
 'demo-j':{name:'Учебный транк Ж',numbers:['DEMO-J-01','DEMO-J-02']},
};
export function defaultSettings(project:DemoProject):ProjectSettings{
 return {running:true,mode:'predictive',operators:[...project.operators],days:[1,2,3,4,5],start:'09:00',end:'20:00',clientStart:'09:00',clientEnd:'20:00',maxAttempts:3,ringSeconds:50,channels:5,trunk:project.base==='М'?'demo-m':'demo-j',rotation:'cycle',order:'attempts',rules:{
  'Нет ответа':{action:'retry',minutes:30,target:''},'Занято':{action:'retry',minutes:10,target:''},'Автоответчик':{action:'retry',minutes:60,target:''},'Ошибка':{action:'retry',minutes:15,target:''},
 }};
}
export function validateSettings(value:ProjectSettings,project:DemoProject,projects:DemoProject[]){
 const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
 if(!value.days.length||value.days.some(d=>!Number.isInteger(d)||d<0||d>6))throw Error('Выберите хотя бы один рабочий день');
 if(![value.start,value.end,value.clientStart,value.clientEnd].every(t=>time.test(t))||value.start>=value.end||value.clientStart>=value.clientEnd)throw Error('Начало каждого окна должно быть раньше окончания; ночные окна в демо не используются');
 if(!value.operators.length||value.operators.some(o=>!project.operators.includes(o)))throw Error('Выберите хотя бы одного оператора команды');
 for(const [n,min,max,label] of [[value.maxAttempts,1,10,'Попытки'],[value.ringSeconds,10,90,'Время дозвона'],[value.channels,1,20,'Каналы']] as const){if(!Number.isInteger(n)||n<min||n>max)throw Error(`${label}: от ${min} до ${max}`);}
 if(!['predictive','progressive'].includes(value.mode)||!['attempts','east'].includes(value.order)||!['cycle','fixed'].includes(value.rotation)||!Object.hasOwn(demoTrunks,value.trunk))throw Error('Проверьте режим и учебное подключение');
 for(const r of retryResults){const rule=value.rules[r];if(!rule||!['retry','finish','transfer'].includes(rule.action)||!Number.isInteger(rule.minutes)||rule.minutes<1||rule.minutes>1440)throw Error('Задержка результата: от 1 до 1440 минут');
  if(rule.action==='transfer'&&!projects.some(p=>p.id===rule.target&&p.id!==project.id&&p.base===project.base))throw Error('Для перевода выберите другой проект той же базы');
 }
}
export function localClock(now:number,offset=3){return new Date(now+offset*3600000).toISOString().slice(0,16);}
export function clockLabel(now:number,offset=3){return localClock(now,offset).replace('T',' ');}
function within(now:number,offset:number,start:string,end:string){const t=localClock(now,offset).slice(11,16);return t>=start&&t<end;}
export function projectBlock(s:DemoState,p:DemoProject){
 const cfg=s.settings[p.id];if(!cfg.running)return 'Проект на паузе';
 if(!cfg.days.includes(new Date(s.now+3*3600000).getUTCDay())||!within(s.now,3,cfg.start,cfg.end))return 'Вне расписания проекта (МСК)';
 return '';
}
export function waitingReason(s:DemoState,c:DemoClient,p:DemoProject,operator=''){
 const cfg=s.settings[p.id];
 if(!['queued','callback'].includes(c.state))return 'Не в очереди';
 if(['ЧС','ПВ'].includes(c.sheet))return 'Лист запрещает обзвон';
 if(c.state!=='callback'&&(c.owner||c.sheet==='К'))return 'Клиент закреплён';
 if(c.state==='callback'&&operator&&c.callbackOperator!==operator)return 'Перезвон другому оператору';
 if(c.state==='callback'&&!cfg.operators.includes(c.callbackOperator||''))return 'Оператор перезвона исключён из проекта';
 if(c.owner&&c.owner!==c.callbackOperator)return 'Владелец клиента изменился';
 if(c.state!=='callback'&&c.attempts>=cfg.maxAttempts)return 'Лимит попыток исчерпан';
 if(c.nextAt>s.now)return 'Ожидает назначенного времени';
 if(!within(s.now,c.utcOffset,cfg.clientStart,cfg.clientEnd))return 'Вне местного времени клиента';
 return projectBlock(s,p);
}
export function readyClients(s:DemoState,p:DemoProject,operator=''){
 return s.clients.filter(c=>c.project===p.id&&!waitingReason(s,c,p,operator)).sort((a,b)=>s.settings[p.id].order==='east'?b.utcOffset-a.utcOffset||a.attempts-b.attempts:a.attempts-b.attempts||a.id.localeCompare(b.id));
}
export function callerId(s:DemoState,p:DemoProject){const cfg=s.settings[p.id],pool=demoTrunks[cfg.trunk].numbers;const used=s.calls.filter(c=>c.trunk===cfg.trunk).length;return pool[cfg.rotation==='fixed'?0:used%pool.length];}
