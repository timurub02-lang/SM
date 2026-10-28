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
 const parsed=pilotSchema.safeParse(JSON.parse(row.data));
 if(!parsed.success)return <main className="workspace-content"><a href="/">Вернуться в CRM</a><h1>Проверьте настройки проекта</h1><p>Сохранённая структура не прошла проверку. Обзвон недоступен.</p></main>;
 const p=parsed.data;
 const staff=await db().prepare('SELECT data FROM employees WHERE id IN (?,?)').bind(...p.operatorIds).all<{data:string}>();
 const employees=staff.results.map(r=>JSON.parse(r.data) as Employee);
 return <main className="workspace-content" style={{maxWidth:1100,margin:'0 auto'}}>
  <a className="secondary" href="/">Вернуться в CRM</a>
  <div className="page-heading"><div><h1>{p.name}</h1><p>Структура проекта Т1 · тест на собственных номерах</p></div></div>
  <section aria-labelledby="pilot-state"><h2 id="pilot-state">Подготовка к тесту</h2><p><strong>Черновик · обзвон не запущен.</strong> Сохранение структуры не создаёт задачу в Oktell и не запускает вызовы.</p><p>Перед запуском требуется связать задачу Oktell, проверить два рабочих места, доставку контактов, события звонков и записи.</p></section>
  <section aria-labelledby="pilot-clients"><h2 id="pilot-clients">Тестовые контакты</h2><table><caption>Только эти три номера входят в тест</caption><thead><tr><th scope="col">Клиент</th><th scope="col">Номер</th></tr></thead><tbody>{p.contacts.map(c=><tr key={c.phone}><td>{c.name}</td><td>{c.phone}</td></tr>)}</tbody></table></section>
  <section aria-labelledby="pilot-staff"><h2 id="pilot-staff">Операторы</h2><ul>{p.operatorIds.map(id=>{const e=employees.find(x=>x.id===id);return <li key={id}>{e?.name||'Сотрудник не найден'} — {e&&pilotOperatorLinked(e)?'учётная запись Oktell связана; гарнитура требует проверки':'связь с Oktell требует настройки'}</li>;})}</ul></section>
  <section aria-labelledby="pilot-rules"><h2 id="pilot-rules">Обзвон</h2><p>Режим по образцу Т1: предиктивный. Дозвон — {p.ringSeconds} секунд. Общий предел — {p.maxAttempts} попытки на клиента. Сначала контакты с меньшим числом попыток.</p><p>Используются только уже подключённые ресурсы Oktell. Карусель Скорозвона не переносится. Предиктивный режим и детекция автоответчиков требуют проверки на нашей установке.</p><table><caption>Повторы: общий предел попыток действует дополнительно к правилам исходов</caption><thead><tr><th scope="col">Исход</th><th scope="col">Когда повторить</th><th scope="col">Предел по исходу</th></tr></thead><tbody>{p.retries.map(r=><tr key={r.result}><td>{outcomes[r.result]}</td><td>{r.kind==='not_before'?'Не раньше чем через':'Через'} {r.minutes} мин.</td><td>{r.attempts}</td></tr>)}</tbody></table></section>
  <section aria-labelledby="pilot-time"><h2 id="pilot-time">Расписание</h2><p>Время проекта — Москва. Дополнительно учитывается местное время клиента: {p.clientWindow.from}–{p.clientWindow.to}.</p><ul>{p.schedule.map(s=><li key={`${s.day}-${s.from}`}>{days[s.day]}: {s.from}–{s.to}</li>)}</ul></section>
  <section aria-labelledby="pilot-results"><h2 id="pilot-results">Результаты разговора</h2><p>{p.results.join(' · ')}</p><p>Соединение не создаёт заказ автоматически. Перенос в другие рабочие проекты для этого теста не включён.</p></section>
 </main>;
}
