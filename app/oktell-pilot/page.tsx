import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {sessionEmployee} from '@/lib/auth';
import {db} from '@/lib/db';
import {pilotSchema,pilotSetting,pilotOperatorLinked} from '@/lib/oktell-pilot';
import type {Employee} from '@/lib/crm';

export const dynamic='force-dynamic';
export const metadata={title:'СМ · Тестовый проект Oktell'};
const days=['','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
const outcomes={busy:'Занято',no_answer:'Нет ответа',declined:'Отклонён',lost:'Потерян',answering_machine:'Автоответчик',error:'Ошибка'};
export default async function Page(){
 const actor=await sessionEmployee(new Headers(await headers()));
 if(!actor)redirect('/login');
 if(actor.role!=='admin')redirect('/');
 const row=await db().prepare('SELECT data FROM settings WHERE id=?').bind(pilotSetting).first<{data:string}>();
 if(!row)return <main className="workspace-content"><a href="/">Вернуться в CRM</a><h1>Тестовый проект Oktell</h1><p>Настройки проекта ещё не загружены.</p></main>;
 let stored:unknown;
 try{stored=JSON.parse(row.data);}catch{stored=null;}
 const parsed=pilotSchema.safeParse(stored);
 if(!parsed.success)return <main className="workspace-content"><a href="/">Вернуться в CRM</a><h1>Проверьте настройки проекта</h1><p>Сохранённая структура не прошла проверку. Обзвон недоступен.</p></main>;
 const p=parsed.data;
 const staff=await db().prepare('SELECT data FROM employees WHERE id IN (?,?)').bind(...p.operatorIds).all<{data:string}>();
 const employees=staff.results.map(r=>JSON.parse(r.data) as Employee);
 return <main className="workspace-content" style={{maxWidth:1100,margin:'0 auto'}}>
  <a className="secondary" href="/">Вернуться в CRM</a>
  <div className="page-heading"><div><h1>{p.name}</h1><p>Структура проекта Т1 · тест на собственных номерах</p></div></div>
  <section aria-labelledby="pilot-state"><h2 id="pilot-state">Подготовка к тесту</h2>{p.native?<><p><strong>Проект загружен · задача сохранена неактивной.</strong> Три контакта и два оператора назначены в Oktell. Линия: {p.native.line}.</p><p>Состояние проверено {new Date(p.native.verifiedAt).toLocaleString('ru-RU',{timeZone:p.timezone})} МСК. Это сохранённая проверка, а не мониторинг состояния АТС.</p></>:<p><strong>Черновик · обзвон не запущен.</strong> Задача Oktell ещё не подтверждена.</p>}<p>Приём вызова Т1, открытие карточки, история и форма результата подключены в CRM. Для теста Ирина и Надежда подключают гарнитуры в разделе «Звонки» и выбирают «Готов». Администратор отдельно запускает задачу в Oktell только после разрешения на звонки. Подключение гарнитуры не запускает задачу. Живой звук и фактический перезвон ещё предстоит проверить.</p></section>
  <section aria-labelledby="pilot-clients"><h2 id="pilot-clients">Тестовые контакты</h2><table><caption>Только эти три номера входят в тест</caption><thead><tr><th scope="col">Клиент</th><th scope="col">Номер</th></tr></thead><tbody>{p.contacts.map(c=><tr key={c.phone}><td>{c.name}</td><td>{c.phone}</td></tr>)}</tbody></table></section>
  <section aria-labelledby="pilot-staff"><h2 id="pilot-staff">Операторы</h2><ul>{p.operatorIds.map(id=>{const e=employees.find(x=>x.id===id);return <li key={id}>{e?.name||'Сотрудник не найден'} — {e&&pilotOperatorLinked(e)?(p.native?.operatorUserIds.includes(e.oktell!.userId!)?'назначен в задачу Oktell; гарнитура требует проверки':'учётная запись связана; назначение в задачу не подтверждено'):'связь с Oktell требует настройки'}</li>;})}</ul></section>
  <section aria-labelledby="pilot-rules"><h2 id="pilot-rules">Правила по образцу Т1</h2><p>Ниже сохранён целевой шаблон. Все правила повторов, общий предел попыток, порядок контактов и местное время клиента ещё не подключены к задаче Oktell.</p><p>Режим по образцу Т1: предиктивный. Дозвон — {p.ringSeconds} секунд. Общий предел — {p.maxAttempts} попытки на клиента. Сначала контакты с меньшим числом попыток.</p><p>Используются только уже подключённые ресурсы Oktell. Карусель Скорозвона не переносится. В Oktell выбран прогрессивно-предиктивный режим. Детекция автоответчиков требует отдельной проверки.</p><table><caption>Повторы: общий предел попыток действует дополнительно к правилам исходов</caption><thead><tr><th scope="col">Исход</th><th scope="col">Когда повторить</th><th scope="col">Предел по исходу</th></tr></thead><tbody>{p.retries.map(r=><tr key={r.result}><td>{outcomes[r.result]}</td><td>{r.kind==='not_before'?'Не раньше чем через':'Через'} {r.minutes} мин.</td><td>{r.attempts}</td></tr>)}</tbody></table></section>
  <section aria-labelledby="pilot-time"><h2 id="pilot-time">Расписание</h2><p>Время проекта — Москва. Целевое окно местного времени клиента: {p.clientWindow.from}–{p.clientWindow.to}.</p><ul>{p.schedule.map(s=><li key={`${s.day}-${s.from}`}>{days[s.day]}: {s.from}–{s.to}</li>)}</ul></section>
  <section aria-labelledby="pilot-results"><h2 id="pilot-results">Результаты разговора</h2><p>{p.results.join(' · ')}</p><p>После разговора выберите результат в форме Т1. «Перезвон» передаёт выбранное время в Oktell. Пока АТС не подтвердит результат, CRM показывает ожидание; повторная отправка не выполняется автоматически. Соединение не создаёт заказ автоматически. Перенос в другие рабочие проекты для этого теста не включён.</p></section>
 </main>;
}
