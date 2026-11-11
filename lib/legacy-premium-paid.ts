import type {Order} from './crm.ts';

// An explicit imported payroll statement can override an old LV label.
export function legacyPremiumPaid(order:Order){return (!!order.priorPremiumPaid||order.legacyLv?.status==='Выплачен')&&!order.importedPayment;}
