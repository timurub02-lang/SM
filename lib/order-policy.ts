import {z} from 'zod';
const hours=z.number().int().min(1).max(8760);
export const orderPolicySchema=z.object({reworkHours:hours.nullable(),finalHours:hours.nullable(),reworkWarningHours:hours,finalWarningHours:hours,operatorDraftEdit:z.boolean(),operatorReworkEdit:z.boolean(),logisticDetailsEdit:z.boolean()});
export type OrderPolicy=z.infer<typeof orderPolicySchema>;
export const defaultOrderPolicy:OrderPolicy={reworkHours:96,finalHours:24,reworkWarningHours:24,finalWarningHours:6,operatorDraftEdit:true,operatorReworkEdit:true,logisticDetailsEdit:true};
export function orderDataEditingEnabled(role:string,status:string,policy:OrderPolicy=defaultOrderPolicy){
 if(role==='operator')return status==='draft'?policy.operatorDraftEdit:status==='rework'?policy.operatorReworkEdit:false;
 if(role==='logistic'||role==='chief_logistic')return policy.logisticDetailsEdit;
 return true; // This switch never replaces existing role, ownership and shipment guards.
}
