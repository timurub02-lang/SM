'use client';
import {useState,type ReactNode} from 'react';
import {cashSpendPurposes} from '@/lib/cash';
import {Pencil} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './ui/dialog';
import {SettingsRulesTabs,rules} from './settings-rules-tabs';
import {CourierRules} from './courier-rules';
import {OrderRules} from './order-rules';
import {OrderSettings} from './order-settings';
import {sectionRuleGroups} from './section-rule-groups';
import {defaultOrderPolicy} from '@/lib/order-policy';
import type {Employee,State} from '@/lib/crm';

const settings:Record<string,string[]>={
 base:['Закрепление при ручной передаче — 24 часа. После выкупа — 5 недель. Эти сроки сейчас фиксированы.','Добавление, импорт и передача клиентов доступны в самом разделе.'],
 mine:['Список определяется закреплением клиентов и вашим отделом. Сроки закрепления пока не настраиваются индивидуально.'],
 incoming:['Номера обратной связи и их привязку к отделам настраивает администратор.'],
 orders:['Таймеры и разрешения редактирования настраивает администратор.'],
 rework:['Срок доработки и порог «Скоро отменится» задаются в общих настройках заказов.'],
 confirm:['Таймеры первого, повторного и финального подтверждения и право логиста редактировать данные задаются в общих настройках заказов.'],
 check:['Проверка требуется для заказов СДЭК. Для Москвы и Почты России этот этап пропускается. Маршрут сейчас фиксирован.'],
 shipping:['Аккаунты и автоматическое распределение настраивает администратор. Тариф и ПВЗ получателя выбираются в карточке заказа.'],
 courierReturns:['Заказы, переданные курьером в работу логистам. Посылки остаются у курьера. Таймеры задаются в настройках заказов.'],
 moscow:['Стоимость доставки задаётся в карточке заказа. Единственный курьер назначается автоматически, при нескольких — выбирается при передаче.','Вознаграждение курьера пока не настроено: нужно определить сумму и правила начисления.'],
 post:['Стоимость доставки задаётся в карточке заказа. Оплату клиента и получение денег логист подтверждает отдельно. Автоматической связи с Почтой России пока нет.'],
 finances:[`Начальный остаток задаётся через «Пополнить». Назначение и дата указываются при операции. Доступные назначения списания: ${cashSpendPurposes.join('; ')}. Если расхода нет в списке, выберите «Другое — указать вручную» и напишите назначение. Для списания нужно выбрать назначение или написать причину; для ручного пополнения причина поступления обязательна. Перевод сотруднику оформляется отдельно.`,'Напоминание: позже добавить выбор месяца, за который оплачиваются уборка и зарплата. Сейчас указывается только дата списания.','Настройки размера вознаграждения курьера пока не реализованы.'],
 team:['Роль, отдел, логин и доступ к CRM меняются в карточке сотрудника. Доступные сотрудники и роли ограничены вашими правами.'],
 redemption:['Раздел пока не наполнен. Настраиваемых параметров проекта выкупа пока нет.'],
 settings:['Подключения сервисов доступны ниже. Настройки интеграций изменяет администратор.']
};
export function SectionSettings({section,label,actor,state,onSaved,onNavigate,children}:{section:string;label:string;actor:Employee;state:State;onSaved:()=>Promise<void>;onNavigate:()=>void;children?:ReactNode}){
 const [open,setOpen]=useState(false);
 const policy=state.settings.orderPolicy||defaultOrderPolicy;
 const orderSection=['orders','rework','confirm','check'].includes(section);
 let groups:readonly string[]=[];
 if(['base','mine'].includes(section))groups=['Клиенты и закрепление','Видимость телефонов'];
 if(section==='team')groups=['Роли и доступ'];

 if(section==='post')groups=['Почта России'];
 if(section==='finances'&&actor.role!=='department_head')groups=['Финансы'];
 if(section==='settings')groups=['Напоминания'];
 if(['shipping','moscow','post','courierReturns'].includes(section))groups=[...groups,'Совместная работа логистов','Напоминания'];
 const paragraphs=sectionRuleGroups.filter(([title])=>groups.includes(title));
 const sectionRules=<div className="section-work-rules">
  {orderSection&&<OrderRules policy={policy}/>}{["moscow","courierReturns"].includes(section)&&<CourierRules policy={policy}/>}
  {paragraphs.map(([title,items])=><section key={title}><h3>{title}</h3>{items.map(text=><p key={text}>{text}</p>)}</section>)}
  {section==='finances'&&actor.role==='department_head'&&<section><h3>Моя касса</h3><p>Вы видите свою кассу. Пополнение и списание сохраняются с датой и назначением. Нельзя списать больше остатка. Перевод сразу уменьшает кассу отправителя, но добавляется получателю только после подтверждения фактического получения. Ожидаемое поступление отображается серым. Назначения списания: {cashSpendPurposes.join("; ")}. Для своего расхода выберите «Другое — указать вручную» и заполните причину под списком. Для ручного пополнения причина поступления также обязательна.</p><p>Напоминание: позже добавить выбор месяца, за который оплачиваются уборка и зарплата. Сейчас указывается только дата списания.</p></section>}
  {section==='team'&&<section><h3>Удаление сотрудника</h3><p>Администратор может удалять сотрудников, руководитель — операторов своего отдела. Собственную учётную запись удалить нельзя. Клиенты и их заказы во всех статусах передаются другому оператору того же отдела либо освобождаются. Свободные клиенты с активными заказами остаются в К, с выкупами без активных заказов переходят в П без ожидания 5 недель, остальные — в исходный лист. Главный логист не удаляет сотрудников.</p></section>}
  {section==='redemption'&&<p>Рабочие правила проекта выкупа ещё не заданы.</p>}
  {section==='incoming'&&rules.incoming.map(([title,text])=><section key={title}><h3>{title}</h3><p>{text}</p></section>)}
  {section==='shipping'&&rules.cdek.map(([title,text])=><section key={title}><h3>{title}</h3><p>{text}</p></section>)}
 </div>;
 return <><button type="button" className="sidebar-settings-pencil" aria-label={`Настройки и правила: ${label}`} title={`Настройки и правила: ${label}`} onClick={()=>setOpen(true)}><Pencil size={16}/></button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="form-dialog cdek-routing-dialog"><DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>Настройки раздела и правила работы</DialogDescription></DialogHeader><SettingsRulesTabs rulesContent={sectionRules}><div className="stack">{(settings[section]||[]).filter(text=>!(section==='finances'&&actor.role==='department_head'&&text.includes('курьера'))).map(text=><p key={text}>{text}</p>)}{(orderSection||['moscow','courierReturns'].includes(section))&&actor.role==='admin'&&<OrderSettings actorId={actor.id} onSaved={onSaved} triggerLabel="Изменить таймеры и редактирование"/>}{orderSection&&actor.role!=='admin'&&<p className="notice">Действующие сроки: первое подтверждение — {policy.confirmationHours===null?'без таймера':`${policy.confirmationHours} ч`}, повторное подтверждение — {policy.extraConfirmationHours===null?'без таймера':`${policy.extraConfirmationHours} ч`}, доработка — {policy.reworkHours===null?'без таймера':`${policy.reworkHours} ч`}, финальное подтверждение — {policy.finalHours===null?'без таймера':`${policy.finalHours} ч`}. Изменить их может администратор.</p>}{children}<button type="button" className="secondary" onClick={()=>{setOpen(false);onNavigate();}}>Открыть раздел «{label}»</button></div></SettingsRulesTabs></DialogContent></Dialog></>;
}
