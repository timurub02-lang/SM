import type {ActivityDb} from './activity-store.ts';
const ready=new WeakMap<ActivityDb,Promise<void>>();
export function initCrmReadIndexes(d:ActivityDb){
 let pending=ready.get(d);if(pending)return pending;
 pending=d.batch([
  'CREATE INDEX IF NOT EXISTS idx_events_time ON events(at DESC,id DESC)',
  'CREATE INDEX IF NOT EXISTS idx_events_client_time ON events(client_id,at DESC,id DESC)',
  'CREATE INDEX IF NOT EXISTS idx_events_order_time ON events(order_id,at DESC,id DESC)',
  "CREATE INDEX IF NOT EXISTS idx_orders_manager_status ON orders(json_extract(data,'$.manager'),json_extract(data,'$.status'))",
  // Scope membership needs IDs, not full JSON rows. TEXT primary keys are not
  // implicitly covered by the existing manager/status and client_id indexes.
  "CREATE INDEX IF NOT EXISTS idx_orders_manager_id ON orders(json_extract(data,'$.manager'),id)",
  'CREATE INDEX IF NOT EXISTS idx_orders_client_id ON orders(client_id,id)',
  "CREATE INDEX IF NOT EXISTS idx_clients_owner ON clients(json_extract(data,'$.owner'),id)",
  "CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(json_extract(data,'$.status'),id)",
 ].map(sql=>d.prepare(sql))).then(()=>{}).catch(error=>{ready.delete(d);throw error;});
 ready.set(d,pending);return pending;
}
