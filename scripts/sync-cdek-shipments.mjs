import {openDatabase} from '../server/sqlite.ts';
import {syncCdekShipments} from '../lib/cdek-shipment-sync.ts';
const path=process.env.CRM_DATABASE_PATH;if(!path)throw Error('CRM_DATABASE_PATH is required');
const db=openDatabase(path);
try{const result=await syncCdekShipments(db);console.log(JSON.stringify(result));if(result.failed)process.exitCode=1;}
catch{console.error('CDEK shipment status check failed');process.exitCode=1;}
finally{db.close();}
