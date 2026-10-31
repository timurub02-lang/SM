import type {ActivityDb} from './activity-store.ts';
export async function initImportMembers(d:ActivityDb){
 await d.prepare(`CREATE TABLE IF NOT EXISTS base_import_members(
  session TEXT NOT NULL,client_id TEXT NOT NULL,base TEXT NOT NULL,
  filename TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(session,client_id))`).run();
}
