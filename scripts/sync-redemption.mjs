import {openDatabase} from '../server/sqlite.ts';
import {runRedemptionDay} from '../lib/redemption-dispatch.ts';
if(!process.env.CRM_DATABASE_PATH)throw Error('CRM_DATABASE_PATH is required');
const d=openDatabase(process.env.CRM_DATABASE_PATH);
try{await runRedemptionDay(d);}catch(e){console.error(e.message);process.exitCode=1;}finally{d.close();}
