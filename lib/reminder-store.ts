import type {ActivityDb as Db} from './activity-store.ts';
export async function initReminderStore(d:Db){await d.prepare('CREATE TABLE IF NOT EXISTS reminders(employee_id TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,at TEXT NOT NULL,read_at TEXT,PRIMARY KEY(employee_id,id))').run();}
