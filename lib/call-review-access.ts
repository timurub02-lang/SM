import type {Employee} from './crm.ts';

export function canReviewCalls(employee?: Pick<Employee,'id'|'role'|'impersonation'> | null) {
  return employee?.role === 'purchasing' && employee.id === 'E-45fa4ec3-eac' && !employee.impersonation;
}
