import {openDatabase} from '../server/sqlite.ts';
import {syncCdekDeletions} from '../lib/cdek-deletion-sync.ts';
const path=process.env.CRM_DATABASE_PATH;if(!path)throw Error('CRM_DATABASE_PATH is required');
const db=openDatabase(path);
try{const result=await syncCdekDeletions(db);console.log(JSON.stringify(result));if(result.failed)process.exitCode=1;}
catch{console.error('CDEK deletion status check failed');process.exitCode=1;}
finally{db.close();}
