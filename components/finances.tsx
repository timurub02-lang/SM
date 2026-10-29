"use client";
import {CdekPaymentConflicts} from "@/components/cdek-payment-conflicts";
import {EmployeeCash} from "@/components/employee-cash";
import {Cash} from "@/components/cash";
import {hasCash} from "@/lib/cash";
import {type Order,type Employee} from "@/lib/crm";

export function Finances({orders,employee}:{orders:Order[];employee:Employee}){return <div className="stack">{employee.role==="admin"&&<><EmployeeCash/><CdekPaymentConflicts orders={orders}/></>}{hasCash(employee.role)&&<Cash key={employee.id} actorId={employee.id}/>}{["admin","department_head"].includes(employee.role)&&<details className="table-panel cash-panel"><summary><strong>Премия</strong></summary><div className="empty"><h3>Правила расчёта премии ещё не настроены</h3><p>Здесь будет расчёт премий и выплат руководителям и операторам.</p></div></details>}{!["department_head","purchasing"].includes(employee.role)&&<div className="notice amber"><div><strong>Нужно настроить вознаграждение курьера</strong><p>За каждый заказ курьеру полагается вознаграждение. Позже необходимо определить сумму и правила начисления. Сейчас вознаграждение не рассчитывается и не вычитается из принятых денег.</p></div></div>}</div>;}
