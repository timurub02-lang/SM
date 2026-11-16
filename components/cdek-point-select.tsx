'use client';
import {Combobox as Primitive} from '@base-ui/react';
import {Combobox,ComboboxInput,ComboboxList,ComboboxItem} from '@/components/ui/combobox';
import {filterCdekPoints,type SearchableCdekPoint} from '@/lib/cdek-point-search';
export function CdekPointSelect({points,value,onChange,label='ПВЗ получателя',savedLabel,requireCod=false,disabled=false}:{points:SearchableCdekPoint[];value:string;onChange:(code:string)=>void;label?:string;savedLabel?:string;requireCod?:boolean;disabled?:boolean}){
 const caption=(code:string)=>{const p=points.find(p=>p.code===code);return p?(p.sameStreet?'На улице клиента · ':p.samePostalCode?'Индекс клиента · ':'')+p.code+' · '+p.address+' · '+p.workTime+(p.allowedCod===false?' · без наложенного платежа':''):savedLabel||code;};
 return <div className="cdek-point-select"><Combobox items={points.map(p=>p.code)} value={value||null} disabled={disabled} itemToStringLabel={caption} filter={(code,query)=>filterCdekPoints(points.filter(p=>p.code===code),query).length>0} onValueChange={code=>{if(code)onChange(code);}} autoHighlight>
  <ComboboxInput aria-label={label} placeholder="Поиск ПВЗ по адресу или коду" disabled={disabled}/>
  <Primitive.Positioner sideOffset={4} className="cdek-point-positioner"><Primitive.Popup className="cdek-point-popup"><Primitive.Empty className="muted">ПВЗ не найдены. Измените поисковый запрос.</Primitive.Empty><ComboboxList>{(code:string)=><ComboboxItem key={code} value={code} disabled={requireCod&&!points.find(p=>p.code===code)?.allowedCod}>{caption(code)}</ComboboxItem>}</ComboboxList></Primitive.Popup></Primitive.Positioner>
 </Combobox></div>;
}
