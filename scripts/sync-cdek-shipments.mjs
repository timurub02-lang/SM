import {openDatabase} from '../server/sqlite.ts';
import {syncCdekRemittances} from '../lib/cdek-remittance-sync.ts';
import {syncCdekShipments} from '../lib/cdek-shipment-sync.ts';
const path=process.env.CRM_DATABASE_PATH;if(!path)throw Error('CRM_DATABASE_PATH is required');
const db=openDatabase(path);
try{const result=await syncCdekShipments(db);const remittances=await syncCdekRemittances(db);console.log(JSON.stringify({...result,remittances}));if(result.failed||remittances.failed)process.exitCode=1;}
catch{console.error('CDEK shipment status check failed');process.exitCode=1;}
finally{db.close();}
