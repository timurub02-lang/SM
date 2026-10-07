import {z} from 'zod';
const hours=z.number().int().min(1).max(8760);
export const orderPolicySchema=z.object({courierConfirmationHours:hours.nullable().default(48),courierWarningHours:hours.default(6),draftHours:hours.nullable().default(24),confirmationHours:hours.nullable().default(48),extraConfirmationHours:hours.nullable().default(48),reworkHours:hours.nullable(),finalHours:hours.nullable(),reworkWarningHours:hours,finalWarningHours:hours,operatorDraftEdit:z.boolean(),operatorReworkEdit:z.boolean(),logisticDetailsEdit:z.boolean()});
export type OrderPolicy=z.infer<typeof orderPolicySchema>;
export const defaultOrderPolicy:OrderPolicy={courierConfirmationHours:48,courierWarningHours:6,draftHours:24,confirmationHours:48,extraConfirmationHours:48,reworkHours:96,finalHours:24,reworkWarningHours:24,finalWarningHours:6,operatorDraftEdit:true,operatorReworkEdit:true,logisticDetailsEdit:true};
export function orderDataEditingEnabled(role:string,status:string,policy:OrderPolicy=defaultOrderPolicy){
 if(role==='operator')return status==='draft'?policy.operatorDraftEdit:status==='rework'?policy.operatorReworkEdit:false;
 if(role==='logistic'||role==='chief_logistic')return policy.logisticDetailsEdit;
 return true; // This switch never replaces existing role, ownership and shipment guards.
}
