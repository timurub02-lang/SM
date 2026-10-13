import {timingSafeEqual} from 'node:crypto';
export function trustedPbx(req:Request){const secret=Buffer.from(process.env.CRM_PHONE_RESULT_KEY||''),given=Buffer.from(req.headers.get('x-crm-pbx-key')||'');return secret.length>=32&&secret.length===given.length&&timingSafeEqual(secret,given);}
