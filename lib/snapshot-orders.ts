import type {Order} from './crm.ts';

// One indexed lookup per order; only project shipment fields used by the snapshot.
export const snapshotOrdersQuery=`SELECT o.data,o.version,
 json_extract(s.data,'$.state') AS shipment_state,
 json_extract(s.data,'$.number') AS shipment_number,
 json_extract(s.data,'$.downloadedAt') IS NOT NULL AS cdek_waybill_received
 FROM orders o LEFT JOIN settings s ON s.id='cdek-shipment-' || o.id ORDER BY o.id DESC`;

export type SnapshotOrderRow={data:string;version:number;shipment_state:unknown;shipment_number:unknown;cdek_waybill_received:number};
export function snapshotOrder(row:SnapshotOrderRow):Order{
 const order=JSON.parse(row.data) as Order;
 const exported=row.shipment_state==='ready'||row.shipment_state==='deleting';
 return {...order,version:row.version,
  cdekTrackingNumber:exported&&row.shipment_number?String(row.shipment_number):undefined,
  cdekExported:exported&&row.shipment_number!==null||(order.testOnly===true&&order.cdekExported===true),
  cdekDeleting:row.shipment_state==='deleting',cdekWaybillReceived:!!row.cdek_waybill_received};
}
