import type {ProjectSettings} from './oktell-project-settings.ts';

type BasicSettings=Pick<ProjectSettings,'name'|'mode'|'ringSeconds'|'maxLines'|'schedule'>;
export const nativeFieldLabels={name:'Название задачи',mode:'Режим набора',ringSeconds:'Время дозвона',maxLines:'Предел линий',schedule:'Расписание по Москве'} as const;
export type NativeField=keyof typeof nativeFieldLabels;
export const nativeModeLabels={preview:'Сначала карточка, затем звонок',progressive:'По одному вызову на свободного оператора',predictive:'Предиктивный обзвон'};
const ordered=(schedule:BasicSettings['schedule'])=>schedule.map(p=>`${p.day}:${p.from}-${p.to}`).sort();
export function nativeSettingsDiff(desired:BasicSettings,current:BasicSettings|null):NativeField[]{
 return (Object.keys(nativeFieldLabels) as NativeField[]).filter(key=>!current||(key==='schedule'
  ?JSON.stringify(ordered(desired.schedule))!==JSON.stringify(ordered(current.schedule))
  :desired[key]!==current[key]));
}
export function nativeFieldValue(settings:BasicSettings,key:NativeField):string{
 if(key==='mode')return nativeModeLabels[settings.mode];
 if(key==='ringSeconds')return `${settings.ringSeconds} сек.`;
 if(key==='schedule')return [...settings.schedule].sort((a,b)=>a.day-b.day||a.from.localeCompare(b.from)).map(p=>`${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'][p.day-1]} ${p.from}–${p.to}`).join('; ')||'Не задано';
 return String(settings[key]);
}
