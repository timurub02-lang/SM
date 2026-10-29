"use client";
import {PremiumStatistics} from "@/components/premium-statistics";
import {PremiumOrders} from "@/components/premium-orders";
import {CdekPaymentConflicts} from "@/components/cdek-payment-conflicts";
import {EmployeeCash} from "@/components/employee-cash";
import {Cash} from "@/components/cash";
import {hasCash} from "@/lib/cash";
import {type Order,type Employee,type Client} from "@/lib/crm";

export function Finances({orders,employee,employees,clients,onOpen,onReload}:{orders:Order[];employee:Employee;employees:Employee[];clients:Client[];onOpen:(id:string)=>void;onReload:()=>Promise<unknown>}){return <div className="stack">{employee.role==="admin"&&<><EmployeeCash/><CdekPaymentConflicts orders={orders}/></>}{hasCash(employee.role)&&<Cash key={`cash-${employee.id}`} actorId={employee.id}/>}{["admin","department_head","operator"].includes(employee.role)&&<PremiumOrders key={`premium-${employee.id}`} orders={orders} employee={employee} employees={employees} clients={clients} onOpen={onOpen} onReload={onReload}/>}{["admin","department_head"].includes(employee.role)&&<PremiumStatistics employee={employee}/>} {!["department_head","purchasing","operator"].includes(employee.role)&&<div className="notice amber"><div><strong>Нужно настроить вознаграждение курьера</strong><p>За каждый заказ курьеру полагается вознаграждение. Позже необходимо определить сумму и правила начисления. Сейчас вознаграждение не рассчитывается и не вычитается из принятых денег.</p></div></div>}</div>;}
