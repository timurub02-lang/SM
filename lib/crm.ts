import {addressPartsSchema,type AddressParts} from "./address.ts";
import { z } from "zod";
export const statuses = {draft:"Оформление",confirm:"Подтверждение",rework:"Возврат оператору",check:"Проверка",extra:"Доп. подтверждение",packing:"Упаковка",phone:"Подготовка телефона",shipping:"В доставке",pickup:"Ожидает выкупа",redeemed:"Выкуплен",refused:"Отказ",returned:"Возврат"} as const;
export type Status=keyof typeof statuses;
export const orderGroups = [
 {id:"new",label:"Новый",stages:["draft","confirm","rework"]},
 {id:"accepted",label:"Принят",stages:["check","extra","packing","phone"]},
 {id:"cancelled",label:"Отменён",stages:["refused"]},
 {id:"sent",label:"Отправлен",stages:["shipping","pickup"]},
 {id:"paid",label:"Оплачен",stages:["redeemed"]},
 {id:"returned",label:"Возврат",stages:["returned"]},
];
export const orderGroup=(status:Status)=>orderGroups.find(g=>g.stages.includes(status))!;

export const transitions:Record<Status,Status[]>={draft:["confirm","refused"],confirm:["check","rework"],rework:["confirm","refused"],check:["packing","extra"],extra:["packing","rework"],packing:["phone"],phone:[],shipping:[],pickup:[],redeemed:[],refused:[],returned:[]};
export const departments={"1":"SKP_","2":"POD_","3":"M31_","4":"UDL_","5":"A_"} as const;
export const departmentIds=["1","2","3","4","5"] as const;
export const roles={operator:"Оператор",logistic:"Логист",admin:"Администратор",department_head:"Руководитель отдела",redemption:"Отдел выкупа"};
export type Client={importRetentionUntil?:string;orderRequest?:{id:string;actorId:string;manager:string;department:string;status:"pending"|"approved"|"rejected";at:string};trialUntil?:string;trialReturnSheet?:string;id:string;name:string;phone:string;city:string;address:string;addressParts?:AddressParts;addressOriginal?:string;addressReview?:boolean;addressProcessed?:boolean;addressProcessingError?:boolean;source:string;sheet?:string;returnSheet?:string;assignmentStartedAt?:string;owner:string;assignedUntil:string;createdAt:string;version:number};
export type Item={name:string;quantity:number;price:number};
export const deliverySchema=z.enum(["", "cdek_pickup", "cdek_courier", "moscow_courier", "russian_post"]);
export type DeliveryMethod=z.infer<typeof deliverySchema>;
export const deliveryLabels:Record<DeliveryMethod,string>={"":"Не выбран",cdek_pickup:"СДЭК · ПВЗ",cdek_courier:"СДЭК · Курьер",moscow_courier:"Москва · Курьер",russian_post:"Почта России"};
export type Order={deliveryReset?:{at:string;calculation:boolean;waybill:boolean};adminReviewedAt?:string;testOnly?:boolean;cdekTransferredAt?:string;finalHandoffAt?:string;noAnswerDeadline?:string;reworkDeadline?:string;returnReason?:string;manualDeliveryCost?:number;warehouseReturnedAt?:string;cdekExported?:boolean;cdekWaybillReceived?:boolean;packingWaybillAt?:string;cdekStatus?:{code:string;at:string;revision:string};waybillComment?:string;cdekTariff?:{code:number;name:string;amount:number;min:number;max:number;account:string;slot:number;calculatedAt:string;params:{delivery:"cdek_pickup"|"cdek_courier";originPostalCode:string;originMode:"warehouse"|"door";weight:number;length:number;width:number;height:number}};id:string;clientId:string;address?:string;addressParts?:AddressParts;delivery?:DeliveryMethod;status:Status;items:Item[];comment:string;reason:string;contact:"none"|"missed"|"callback";due:string;round:number;extra:boolean;createdAt:string;confirmedAt?:string;shippedAt?:string;redeemedAt?:string;returnedAt?:string;cancelledAt?:string;updatedAt:string;manager:string;logistic:string;version:number};
export type Employee={hasPassword?:boolean;accessEnabled?:boolean;id:string;name:string;alias:string;login:string;skLogin:string;role:keyof typeof roles;department?:keyof typeof departments;salary:number;bonus:number;version:number};
export type Event={actorId?:string;id:string;clientId:string;orderId:string;at:string;actor:string;text:string};
export type IncomingRequest={id:string;clientId:string;at:string;text:string;source:string};
export type State={incoming?:IncomingRequest[];clients:Client[];orders:Order[];employees:Employee[];events:Event[];settings:{retentionDays:number};};
export const money=(n:number)=>new Intl.NumberFormat("ru-RU",{style:"currency",currency:"RUB",minimumFractionDigits:0,maximumFractionDigits:2}).format(n);
export const total=(o:Order)=>o.items.reduce((n,i)=>n+i.quantity*Math.round(i.price*100),0)/100;
export const initials=(s:string)=>s.split(" ").slice(0,2).map(x=>x[0]).join("");
export const stamp=(s:string)=>s?new Date(s).toLocaleString("ru-RU",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
export const normalizePhone=(v:string)=>{let p=v.replace(/\D/g,"");if(p.length===10)p="7"+p;if(p.length===11&&p.startsWith("8"))p="7"+p.slice(1);return p.length===11&&p.startsWith("7")?"+"+p:"";};
export const daysLeft=(c:Client)=>c.assignedUntil?Math.ceil((Date.parse(c.assignedUntil)-Date.now())/86400000):0;
export const clientSchema=z.object({name:z.string().trim().min(2,"Укажите имя клиента").max(150),phone:z.string().transform(normalizePhone).refine(Boolean,"Укажите российский телефон из 11 цифр"),city:z.string().trim().max(250).default(""),address:z.string().trim().max(500).default(""),addressParts:addressPartsSchema.optional(),source:z.string().trim().max(200).default("Вручную"),owner:z.string().max(100).default("")});
export const itemsSchema=z.array(z.object({name:z.string().trim().min(1,"Укажите товар").max(200),quantity:z.number().int().min(1).max(9999),price:z.number().min(0.01).max(10000000)})).max(100);
export const needsDepartment=(role:string)=>!["logistic","redemption"].includes(role);
export const employeeSchema=z.object({name:z.string().trim().min(2).max(150),alias:z.string().trim().max(100),login:z.string().trim().min(1).max(100),skLogin:z.string().trim().max(100),role:z.enum(["operator","logistic","admin","redemption","department_head"]),department:z.enum(departmentIds,{required_error:"Выберите отдел",invalid_type_error:"Выберите отдел"}).optional(),salary:z.number().min(0).max(10000000),bonus:z.number().min(0).max(100)}).superRefine((employee,ctx)=>{if(needsDepartment(employee.role)&&!employee.department)ctx.addIssue({code:z.ZodIssueCode.custom,path:["department"],message:"Выберите отдел"});}).transform(employee=>({...employee,department:needsDepartment(employee.role)?employee.department:undefined}));
export function orderMissingField(o:Pick<Order,"delivery"|"address"|"items">,c:Pick<Client,"address">){
 if(!o.delivery||!deliverySchema.safeParse(o.delivery).success)return {field:"delivery",label:"Выберите способ доставки"} as const;
 if(!o.items.length)return {field:"basket",label:"Добавьте товар"} as const;
 if(!itemsSchema.safeParse(o.items).success)return {field:"basket",label:"Заполните данные товара"} as const;
 if(!(o.address??c.address).trim())return {field:"address",label:"Заполните адрес"} as const;
 return null;
}
export const operatorReturnLabel=(o:Pick<Order,"round">)=>o.round>1?`После ${o.round-1}-го возврата оператору`:"";
export function allowedOrderTransitions(o:Order,role?:string):Status[]{
 let allowed:Status[]=o.status==="rework"&&o.extra?["extra","refused"]:o.status==="extra"?["packing","rework","refused"]:transitions[o.status];
 if(o.status==="confirm"&&["moscow_courier","russian_post"].includes(o.delivery||""))allowed=allowed.map(to=>to==="check"?"extra":to);
 if(o.finalHandoffAt){
  allowed=allowed.filter(to=>to!=="rework");
  if(["confirm","extra","check"].includes(o.status)&&!allowed.includes("refused"))allowed=[...allowed,"refused"];
 }
 return role==="logistic"?allowed.filter(to=>to!=="refused"||!!o.finalHandoffAt&&["confirm","extra"].includes(o.status)):allowed;
}
export function finalNoAnswerDeadline(o:Order,contact:string,now:string){
 if(!o.finalHandoffAt||!["confirm","extra"].includes(o.status))return undefined;
 return new Date(Date.parse(o.finalHandoffAt)+86400000).toISOString();
}
export function validateTransition(o:Order,to:Status,c:Client,reason:string,role?:string){
 if(o.status==="rework"&&o.reworkDeadline&&Date.now()>=Date.parse(o.reworkDeadline))throw Error("Срок доработки истёк. Заказ подлежит отмене");
 if(["draft","rework"].includes(o.status)&&["confirm","extra"].includes(to)){const missing=orderMissingField(o,c);if(missing)throw Error(missing.label);}
 const allowed=allowedOrderTransitions(o,role);
 if(!allowed.includes(to))throw new Error("Этот переход недоступен для текущего этапа");
 if(["confirm","extra","check","packing"].includes(to)&&(!(o.address??c.address).trim()||!o.items.length))throw new Error("Заполните адрес клиента и корзину заказа");
 if(["rework","refused"].includes(to)&&!reason.trim())throw new Error("Укажите причину возврата или отказа");
}
export function seed():State{
 const employees:Employee[]=[{id:"anna",name:"Оператор 1",alias:"Оператор 1",login:"a.kovaleva",skLogin:"anna_k",role:"operator",salary:40000,bonus:5,version:1},{id:"maria",name:"Оператор 2",alias:"Оператор 2",login:"m.sokolova",skLogin:"maria_s",role:"operator",salary:40000,bonus:5,version:1},{id:"denis",name:"Логист",alias:"Логист",login:"d.pavlov",skLogin:"denis_p",role:"logistic",salary:45000,bonus:3,version:1},{id:"admin",name:"Администратор",alias:"Админ",login:"admin",skLogin:"",role:"admin",salary:0,bonus:0,version:1}];
 return {clients:[],orders:[],employees,events:[],settings:{retentionDays:30}};
}

// Lifecycle timestamps are first-occurrence dates; subsequent actions remain in history.
export function orderDatesForTransition(order:Order,to:Status,at:string):Partial<Order>{
 const dates:Partial<Order>={};
 if(order.status==="check"&&["packing","extra"].includes(to)&&!order.adminReviewedAt)dates.adminReviewedAt=at;
 if((order.status==="confirm"&&["check","extra"].includes(to)||order.status==="extra"&&to==="packing")&&!order.confirmedAt)dates.confirmedAt=at;
 if(to==="shipping"&&!order.shippedAt)dates.shippedAt=at;
 if(to==="redeemed"&&!order.redeemedAt)dates.redeemedAt=at;
 if(to==="returned"&&!order.returnedAt)dates.returnedAt=at;
 if(to==="refused"&&!order.cancelledAt)dates.cancelledAt=at;
 return dates;
}

export const sourceSheet=(source:string)=>source.match(/\.xlsx · (.+)$/i)?.[1]||"";
export const clientSheet=(c:Client)=>c.sheet??sourceSheet(c.source);
export function clientAssignment(c:Client,owner:string,now:string,firstSheet="Т1"):Partial<Client>{
 if(c.owner===owner)return {};
 if(!owner)return {importRetentionUntil:undefined,owner:"",assignedUntil:"",trialUntil:undefined,trialReturnSheet:undefined,assignmentStartedAt:undefined};
 const until=new Date(Date.parse(now)+86400000).toISOString();
 return {importRetentionUntil:undefined,owner,sheet:"К",trialUntil:until,assignedUntil:until,assignmentStartedAt:now,trialReturnSheet:firstSheet,returnSheet:c.returnSheet||((clientSheet(c)!=="К"&&clientSheet(c))||firstSheet)};
}
export function applyRetention(c:Client,orders:Order[],now=Date.now()):Client{
 if(!c.owner)return c;
 const original=c.returnSheet??(clientSheet(c)==="К"?"ТК":clientSheet(c));
 const own=orders.filter(o=>o.clientId===c.id&&o.manager===c.owner&&(!c.assignmentStartedAt||o.createdAt>=c.assignmentStartedAt));
 if(c.trialUntil&&!own.length){return Date.parse(c.trialUntil)>now?c:{...c,owner:"",sheet:c.trialReturnSheet||"Т1",assignedUntil:"",trialUntil:undefined,trialReturnSheet:undefined,assignmentStartedAt:undefined,returnSheet:undefined};}
 const base={...c,trialUntil:undefined,trialReturnSheet:undefined,sheet:"К",returnSheet:original,assignedUntil:"",assignmentStartedAt:c.assignmentStartedAt||own.map(o=>o.createdAt).filter(Boolean).sort()[0]};
 if(!own.length||own.some(o=>["new","accepted","sent"].includes(orderGroup(o.status).id)))return base;
 const paid=own.filter(o=>o.status==="redeemed");
 // Missing historical redemption dates must not silently release a client.
 if(paid.some(o=>!o.redeemedAt||!Number.isFinite(Date.parse(o.redeemedAt))))return base;
 const until=Math.max(paid.length?Math.max(...paid.map(o=>Date.parse(o.redeemedAt!)))+35*86400000:0,Date.parse(c.importRetentionUntil||"")||0);
 if(until>now)return {...base,assignedUntil:new Date(until).toISOString()};
 return {...base,owner:"",sheet:paid.length?"ТК":original,returnSheet:undefined,assignmentStartedAt:undefined};
}

export function clientAddressFromOrder(o:Pick<Order,'address'|'addressParts'>){
 if(!o.address?.trim())return null;
 return {address:o.address.trim(),addressParts:o.addressParts||null,city:o.addressParts?.city||'',addressReview:false,addressProcessingError:false};
}

export const orderEditingLocked=(employee:Pick<Employee,"role"|"id">,order:Pick<Order,"status"|"manager">)=>order.status==="check"&&employee.role!=="admin"?true:employee.role==="operator"?(order.manager!==employee.id||!["draft","rework"].includes(order.status)):!["logistic","admin","redemption"].includes(employee.role);
export const scheduledCalls=(orders:Order[],employee:Pick<Employee,"id"|"role">)=>orders.filter(o=>["callback","missed"].includes(o.contact)&&!!o.due&&Number.isFinite(Date.parse(o.due))&&(employee.role==="operator"?o.manager===employee.id&&["draft","rework"].includes(o.status):employee.role==="logistic"?o.logistic===employee.id&&["confirm","extra","pickup"].includes(o.status):false)).sort((a,b)=>Date.parse(a.due)-Date.parse(b.due));
export const logisticCallsDue=(orders:Order[],actorId:string,now:number)=>scheduledCalls(orders,{id:actorId,role:"logistic"}).filter(o=>Date.parse(o.due)<=now);

export function assignedClients(clients:Client[],employees:Employee[],viewer:Employee){
 const owners=new Set(viewer.role==="department_head"?employees.filter(e=>!!viewer.department&&e.role==="operator"&&e.department===viewer.department).map(e=>e.id):[viewer.id]);
 return clients.filter(c=>owners.has(c.owner));
}

export function departmentOrders(orders:Order[],employees:Employee[],viewer:Employee){
 const operators=new Set(employees.filter(e=>!!viewer.department&&e.role==="operator"&&e.department===viewer.department).map(e=>e.id));
 return orders.filter(o=>operators.has(o.manager));
}

export function employeeForManager(actor:Employee|undefined,data:unknown,existing?:Employee){
 if(actor?.role!=="department_head")return employeeSchema.parse(data);
 if(!actor.department)throw Error("Сначала назначьте отдел руководителю");
 if(existing&&(existing.role!=="operator"||existing.department!==actor.department))throw Error("Можно изменять только операторов своего отдела");
 return employeeSchema.parse({...((data&&typeof data==="object")?data:{}),role:"operator",department:actor.department});
}

export const packingStage=(order:Order)=>order.status==="returned"?(order.warehouseReturnedAt?"warehouse_returned":"returned"):order.cdekExported?"exported":order.packingWaybillAt?"waybill":(order.cdekTariff||order.manualDeliveryCost!==undefined)?"calculated":"new";

export const confirmationStage=(order:Order,now=Date.now())=>{
 const stage=order.finalHandoffAt&&order.noAnswerDeadline&&["confirm","extra"].includes(order.status)&&Date.parse(order.noAnswerDeadline)-now<=6*3600000?"expiring":order.contact==="none"?"new":order.contact;
 return order.status==="extra"?(stage==="new"?"repeat":"repeat_"+stage):stage;
};

export const hasActiveOrder=(orders:Order[],clientId:string)=>orders.some(o=>o.clientId===clientId&&["new","accepted","sent"].includes(orderGroup(o.status).id));

export function visibleIncoming(incoming:IncomingRequest[],clients:Client[],viewer:Employee){
 if(["admin","department_head"].includes(viewer.role))return incoming;
 if(viewer.role!=="operator")return [];
 const owned=new Set(clients.filter(c=>c.owner===viewer.id).map(c=>c.id));
 return incoming.filter(item=>owned.has(item.clientId));
}

export const extraCheckLabel=(order:Pick<Order,"extra"|"status">)=>!order.extra?"":(["packing","phone","shipping","pickup","redeemed","returned"].includes(order.status)?"После доп. проверки":"Нужна доп. проверка");

export const hideClientPhone=(role?:string)=>role==="operator"||role==="department_head";

export const deliveryQueue=(order:Order,view:string)=>view==="moscow"?order.delivery==="moscow_courier":view==="post"?order.delivery==="russian_post":view==="shipping"?!["moscow_courier","russian_post"].includes(order.delivery||""):true;

export function callTimeClass(due:string,now:number){
 const elapsed=now-Date.parse(due);
 return !Number.isFinite(elapsed)||elapsed<0?"":elapsed<300000?"call-due":"overdue-call";
}

export const reworkDeadlineFrom=(at:string)=>new Date(Date.parse(at)+4*24*60*60*1000).toISOString();
export function validateReworkCall(order:Pick<Order,"status"|"reworkDeadline">,due:string){
 if(order.status==="rework"&&order.reworkDeadline&&Date.parse(due)>Date.parse(order.reworkDeadline))throw Error("Звонок нельзя назначить позже срока доработки заказа (4 суток)");
}
export function reworkTimeLeft(deadline:string,now:number){
 const minutes=Math.max(0,Math.ceil((Date.parse(deadline)-now)/60000));
 if(!Number.isFinite(minutes))return "";
 return minutes===0?"Срок истёк — отмена заказа":`${Math.floor(minutes/1440)} д ${Math.floor(minutes%1440/60)} ч ${minutes%60} мин`;
}

export function reworkStage(order:Pick<Order,"reworkDeadline"|"contact"> & {extra?:boolean},now:number){
 const stage=order.reworkDeadline&&Date.parse(order.reworkDeadline)-now<=86400000?"expiring":order.contact==="missed"?"missed":order.contact==="callback"?"callback":"new";
 return order.extra?"extra_"+stage:stage;
}

export function orderLocation(order:Order){
 if(["draft","rework"].includes(order.status))return "У оператора";
 if(order.status==="check")return "У Администратора";
 if(["cdek_pickup","cdek_courier"].includes(order.delivery||"")&&(order.cdekTransferredAt||order.cdekStatus?.code==="CREATED"))return "У СДЭК";
 if(["confirm","extra","packing","phone","shipping","pickup"].includes(order.status))return "У логиста";
 return "—";
}

export const canLogisticEditOrder=(o:Pick<Order,"status"|"cdekExported">)=>!o.cdekExported&&!["redeemed","returned"].includes(o.status);
