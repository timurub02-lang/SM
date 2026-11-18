import type {Order} from './crm.ts';
export type CdekReturnReceipt={deliveredAt:string;detectedAt:string;check?:{state:'confirmed'|'discrepancy';at:string;by:string;name:string;note:string}};
export const returnNeedsCheck=(o:Order)=>!!o.cdekReturnReceipt&&o.cdekReturnReceipt.check?.state!=='confirmed';
