'use client';
import type {Employee} from '@/lib/crm';
import {Switch} from './ui/switch';
export function EmployeeOktell({employee,enabled,onChange,busy}:{employee:Employee|null;enabled:boolean;onChange:(v:boolean)=>void;busy:boolean}){
 const link=employee?.oktell;
 return <section className="stack settings-card"><label className="action-buttons"><Switch checked={enabled} disabled={busy} onCheckedChange={onChange} aria-label="Создать и связать с Oktell"/><strong>Создать и связать с Oktell</strong></label><small className="muted">После сохранения сотрудник создастся в Oktell с таким же логином CRM. Выключение не удаляет уже созданную учётную запись.</small>{link?.userId?<p className="notice">Связан с Oktell · {link.login}</p>:link?.status==='pending'&&link.requested?<p role="status">Создаётся учётная запись Oktell… Обновите карточку через несколько секунд.</p>:link?.status==='error'?<p role="alert">{link.error||'Не удалось создать учётную запись'}. Для повторной попытки включите переключатель и сохраните сотрудника.</p>:null}<small className="muted">Телефон и участие в задаче обзвона настраиваются в Oktell отдельно.</small></section>;
}
