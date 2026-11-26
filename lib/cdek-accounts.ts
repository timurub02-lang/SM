export const accountRowsWhere="id GLOB 'cdek-[1-9]*' AND substr(id,6) NOT GLOB '*[^0-9]*'";
export const accountVersionSql=`(SELECT json_group_array(json_array(id,json_extract(data,'$.checkedAt'),json_extract(data,'$.type'),json_extract(data,'$.name'))) FROM (SELECT id,data FROM settings WHERE ${accountRowsWhere} ORDER BY id))`;
export type AccountType='schedule'|'departmentA';
export type RoutingAccount={slot:number;name:string;configured:boolean;type?:AccountType;checkedAt?:string};
export const departmentAAccount=(a:Pick<RoutingAccount,'type'|'name'>)=>a.type?a.type==='departmentA':/аскеров/i.test(a.name);
export function publicAccount(row:{id:string;data:string}):RoutingAccount{
 const a=JSON.parse(row.data);
 return {slot:Number(row.id.slice(5)),name:a.name,type:departmentAAccount(a)?'departmentA':'schedule',configured:!!(a.clientId&&a.clientSecret),checkedAt:a.checkedAt};
}
export function defaultDepartmentAWeek(accounts:RoutingAccount[]):number[]{
 const candidates=accounts.filter(a=>a.configured&&departmentAAccount(a));
 const first=candidates.find(a=>/аскеров/i.test(a.name))||candidates[0];
 return first?Array(7).fill(first.slot):[];
}
