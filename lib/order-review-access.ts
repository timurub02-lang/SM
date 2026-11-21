import type {Employee,Order} from './crm.ts';
// Explicit delegation to Artem; changing the login must not transfer this permission.
export const canReviewOrders=(e:Pick<Employee,'id'|'role'>)=>e.role==='admin'||e.role==='department_head'&&e.id==='E-74ee9a8f-99d';
export const reviewRole=(e:Pick<Employee,'id'|'role'>,o:Pick<Order,'status'>)=>o.status==='check'&&canReviewOrders(e)?'admin':e.role;
