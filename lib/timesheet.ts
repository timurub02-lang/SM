import {z} from 'zod';
import type {Employee} from './crm';
import {premiumPeriods,shiftDate} from './premium-periods.ts';
export function timesheetStaff(actor:Employee,target:Employee){return target.role==='operator'&&(actor.role==='admin'||actor.role==='department_head'&&!!actor.department&&actor.department===target.department);}
export function timesheetDays(period:string){const p=premiumPeriods.find(p=>p.id===period);if(!p)throw Error('Выберите период');const days:string[]=[];for(let d=p.from;d<=p.cutoff;d=shiftDate(d,1))days.push(d);return days;}
export const timesheetSchema=z.object({employeeId:z.string().min(1),revision:z.string(),days:z.record(z.string(),z.union([z.number().finite().min(0).max(24),z.literal('ОТ')]))});
export type TimesheetRow={days:Record<string,number|'ОТ'>;revision:string;updatedAt?:string;updatedBy?:string};
export function parseTimesheet(body:unknown,period:string){const value=timesheetSchema.parse(body),allowed=new Set(timesheetDays(period));if(Object.keys(value.days).some(d=>!allowed.has(d)))throw Error('Дата вне выбранного периода');return value;}
