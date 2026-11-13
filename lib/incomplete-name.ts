import {z} from 'zod';
export function needsNameExplanation(status:string,to:string,name:string){
 return ['draft','rework'].includes(status)&&['confirm','extra','packing'].includes(to)&&name.trim().split(/\s+/).filter(Boolean).length<3;
}
export const nameExplanationSchema=z.string().trim().min(1,'ФИО неполное. Укажите причину передачи без полного ФИО').max(1000);
