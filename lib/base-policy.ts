import {z} from 'zod';
export const baseTypes=['M','J'] as const;
export const mandatorySheets=['К','П','ЧС','ПВ'] as const;
export const blockedSheets=['К','ЧС','ПВ'] as const;
export const baseLabel=(base:string)=>base==='J'?'Ж':'М';
export const sheetName=z.string().trim().min(1).max(31).regex(/^[^\[\]:*?\/\\]+$/,'Название должно подходить для листа Excel').refine(s=>!s.startsWith("'")&&!s.endsWith("'")&&!['ТК','ТКП','Все клиенты','Связанные номера'].includes(s),'Это название зарезервировано или больше не используется');
export const baseSheetSchema=z.object({name:sheetName,automatic:z.boolean().prefault(false),projectId:z.string().trim().max(100).regex(/^\d*$/,'ID проекта должен содержать только цифры').prefault(''),cycleDays:z.number().int().min(1).max(366).prefault(20),sendTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).prefault('21:00')});
export const baseConfigSchema=z.object({importSheet:sheetName,sheets:z.array(baseSheetSchema).min(4).max(100)}).superRefine((c,ctx)=>{
 if(c.sheets.some(s=>s.automatic&&!s.projectId))ctx.addIssue({code:'custom',message:'Для автоматической отправки укажите проект СК'});
 const names=c.sheets.map(s=>s.name);if(new Set(names.map(n=>n.toLocaleUpperCase('ru-RU'))).size!==names.length||mandatorySheets.some(s=>!names.includes(s))||!names.includes(c.importSheet)||mandatorySheets.includes(c.importSheet as any))ctx.addIssue({code:'custom',message:'Обязательные листы должны присутствовать; лист загрузки должен быть дополнительным; названия не должны повторяться'});
 if(c.sheets.some(s=>blockedSheets.includes(s.name as any)&&(s.projectId||s.automatic)))ctx.addIssue({code:'custom',message:'К, ЧС и ПВ не раздаются'});
});
export const retentionPolicySchema=z.object({mode:z.enum(['fixed','statistics']).prefault('fixed'),days:z.number().int().min(0).max(730).prefault(35),defaultWeeks:z.number().int().min(0).max(104).prefault(5),bands:z.array(z.object({maxPercent:z.number().min(0).max(10000),weeks:z.number().int().min(0).max(104)})).max(20).prefault([])}).refine(p=>p.bands.every((b,i)=>i===0||b.maxPercent>p.bands[i-1].maxPercent),'Пороги должны возрастать');
export const dispatchTargetSchema=z.enum(['skorozvon','oktell']);
export const baseSettingsSchema=z.object({dispatchTarget:dispatchTargetSchema.prefault('skorozvon'),M:baseConfigSchema,J:baseConfigSchema,incomingButtonName:z.string().trim().max(100).prefault(''),retention:z.object({operators:z.record(z.string(),retentionPolicySchema).prefault({}),from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).prefault(''),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).prefault('')}).refine(p=>(!p.from&&!p.to)||(!!p.from&&!!p.to&&p.from<=p.to),'Укажите обе даты периода в правильном порядке').prefault({operators:{},from:'',to:''})});
export type BaseSettings=z.infer<typeof baseSettingsSchema>;
export const initialBaseSettings=():BaseSettings=>({dispatchTarget:'skorozvon',...Object.fromEntries(baseTypes.map(base=>[base,{importSheet:'Т1',sheets:[...mandatorySheets,'Т1'].map(name=>({name,automatic:false,projectId:'',cycleDays:20,sendTime:'21:00'}))}])),incomingButtonName:'',retention:{operators:{},from:'',to:''}}) as BaseSettings;
export const normalizeBaseSheet=(sheet:string)=>sheet==='ТК'||sheet==='ТКП'?'П':sheet||'Т1';
