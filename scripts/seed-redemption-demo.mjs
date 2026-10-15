// Explicit operator-run fixture command; never called by the app or scheduler.
import {openDatabase} from '../server/sqlite.ts';
import {initRedemption,dayOf,dayPlus} from '../lib/redemption.ts';
if(process.argv[2]!=='--create-30-test-orders'||!process.env.CRM_DATABASE_PATH)throw Error('Explicit fixture flag and database path required');
const d=openDatabase(process.env.CRM_DATABASE_PATH);
try{
 await initRedemption(d);
 const existing=await d.prepare("SELECT COUNT(*) n FROM orders WHERE id LIKE 'SM-TEST-VYKUP-%'").first();if(existing.n)throw Error('Test fixtures already exist');
 const staff=(await d.prepare("SELECT id,data FROM employees WHERE json_extract(data,'$.role')='operator' ORDER BY json_extract(data,'$.department'),id").all()).results;
 if(!staff.length)throw Error('No operators');
 const byDepartment=new Map();for(const e of staff){const dep=JSON.parse(e.data).department;if(!byDepartment.has(dep))byDepartment.set(dep,e);}
 const operators=[...byDepartment.values(),...staff.slice(0,4)],now=new Date(),today=dayOf(now),at=now.toISOString(),statements=[];
 const statuses=['ACCEPTED_AT_RECIPIENT_CITY_WAREHOUSE','NOT_DELIVERED','TAKEN_BY_COURIER','ACCEPTED_AT_PICK_UP_POINT'];
 for(let i=1;i<=30;i++){
  const n=String(i).padStart(3,'0'),clientId='C-TEST-VYKUP-'+n,id='SM-TEST-VYKUP-'+n,manager=operators[(i-1)%operators.length].id,phone='+70000000'+n;
  const client={id:clientId,name:'Тест Выкуп '+n,phone,city:'Москва',address:'Тестовый адрес, не отправлять',source:'Тест проекта Выкуп',baseType:'M',sheet:'K',owner:manager,assignedUntil:'2099-12-31T00:00:00Z',createdAt:at,version:1};
  const order={id,clientId,manager,logistic:'',status:'shipping',delivery:'cdek_pickup',items:[],comment:'Тестовый заказ для проверки таблицы. Реальной накладной и товаров нет.',reason:'',contact:'none',due:'',round:1,extra:false,createdAt:at,updatedAt:at,shippedAt:at,version:1,testOnly:true,testTrack:'TEST-CDEK-'+n,cdekStatus:{code:statuses[(i-1)%statuses.length],at,revision:'test'}};
  const entered=dayPlus(today,-((i-1)%4))+'T09:00:00.000Z',expiry=dayPlus(today,i<=6?-1:i<=12?0:7),v={manualStorage:expiry,comments:[{id:'demo-'+n,text:i<=6?'Срок хранения истёк: проверьте Отказ и ПО.':i<=12?'Срок хранения заканчивается сегодня.':'Проверьте выбор действия, даты и комментарии.',author:'Тестовые данные',authorId:'fixture',at}],days:{},updatedAt:at};
  if(i>=25)Object.assign(v,{action:'nd',result:'to_return',author:'Тестовые данные',authorId:'fixture',lastDay:dayPlus(today,-1)});
  else if(i>=19)Object.assign(v,{action:'date',result:'date',resultDate:dayPlus(today,i%2?-1:0),author:'Тестовые данные',authorId:'fixture',lastDay:dayPlus(today,-1)});
  statements.push(d.prepare('INSERT INTO clients(id,phone,data,version) VALUES(?,?,?,1)').bind(clientId,phone,JSON.stringify(client)),d.prepare('INSERT INTO orders(id,client_id,data,version) VALUES(?,?,?,1)').bind(id,clientId,JSON.stringify(order)),d.prepare('INSERT INTO redemption_entries(order_id,entered_at,data) VALUES(?,?,?) ON CONFLICT(order_id) DO NOTHING').bind(id,entered,JSON.stringify(v)));
 }
 const cfg=await d.prepare("SELECT data FROM settings WHERE id='redemption-config'").first();if(cfg&&(JSON.parse(cfg.data).automatic||JSON.parse(cfg.data).projectId))throw Error('Unexpected enabled SK config; review settings');
 await d.batch(statements);

 console.log(JSON.stringify({createdClients:30,createdOrders:30,realCdekShipments:0,skWrites:0}));
}finally{d.close();}
