'use client';
import {useEffect,useState} from 'react';
import {BarChart3,Users,ShoppingBag,X,PhoneOff} from 'lucide-react';
const metrics=[
 {label:'Принято клиентов',description:'Открыто карточек по звонкам',Icon:Users,tone:'clients'},
 {label:'Заказ',description:'Выбран результат «Заказ»',Icon:ShoppingBag,tone:'orders'},
 {label:'Отказ',description:'Выбран результат «Отказ»',Icon:X,tone:'cancelled'},
 {label:'Нет соединения',description:'Выбран результат «Нет соединения»',Icon:PhoneOff,tone:'disconnected'}
];
export default function OperatorDailyStatistics(){
 const [day,setDay]=useState('');
 useEffect(()=>{const update=()=>setDay(new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long'}).format(new Date()));update();const timer=setInterval(update,60000);return()=>clearInterval(timer);},[]);
 return <section className="operator-workspace operator-daily" aria-labelledby="operator-daily-title">
  <div className="operator-workspace-heading"><span className="operator-workspace-icon"><BarChart3 size={24}/></span><div><h2 id="operator-daily-title">За сегодня</h2><p>{day?`${day} · московское время`:'Московское время'}</p></div></div>
  <dl className="operator-daily-grid">{metrics.map(({label,description,Icon,tone})=><div key={tone} className={`operator-daily-metric operator-daily-${tone}`}><dt title={description}><span className="operator-daily-icon"><Icon size={18}/></span>{label}</dt><dd aria-label="Данные ещё не подключены">—</dd><p>{description}</p></div>)}</dl>
  <div className="operator-workspace-foot"><p>Ожидает подключения статистики звонков. Здесь появятся ваши результаты за текущий день.</p></div>
 </section>;
}
