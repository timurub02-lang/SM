"use client";
import {useState} from 'react';
import type {CashPayroll} from '@/lib/premium-cash';
import {PremiumOrders} from "@/components/premium-orders";
import {CdekPaymentConflicts} from "@/components/cdek-payment-conflicts";
import {EmployeeCash} from "@/components/employee-cash";
import {Cash} from "@/components/cash";
import {hasCash} from "@/lib/cash";
import {type Order,type Employee,type Client} from "@/lib/crm";

export function Finances({orders,employee,employees,clients,onOpen,onReload}:{orders:Order[];employee:Employee;employees:Employee[];clients:Client[];onOpen:(id:string)=>void;onReload:()=>Promise<unknown>}){const [cashPayroll,setCashPayroll]=useState<CashPayroll|null>(null);return <div className="stack">{hasCash(employee.role)&&<div className={employee.role==="admin"?"finance-cash-layout":undefined}>{employee.cashDisabled?<section className="card"><h2>Моя касса</h2><strong>Х</strong><p className="muted">Касса отключена</p></section>:<Cash key={`cash-${employee.id}`} actorId={employee.id}/>}{employee.role==="admin"&&<EmployeeCash employees={employees} payroll={cashPayroll}/>}</div>}{["admin","department_head","operator"].includes(employee.role)&&<PremiumOrders onCashPayroll={employee.role==='admin'?setCashPayroll:undefined} key={`premium-${employee.id}`} orders={orders} employee={employee} employees={employees} clients={clients} onOpen={onOpen} onReload={onReload}/>} {!["department_head","purchasing","operator"].includes(employee.role)&&<div className="notice amber"><div><strong>Нужно настроить вознаграждение курьера</strong><p>За каждый заказ курьеру полагается вознаграждение. Позже необходимо определить сумму и правила начисления. Сейчас вознаграждение не рассчитывается и не вычитается из принятых денег.</p></div></div>}{employee.role==="admin"&&<CdekPaymentConflicts orders={orders}/>}</div>;}
