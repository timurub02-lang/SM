import {randomUUID} from 'node:crypto';
export const controlSocket=path=>process.platform==='win32'?'\\\\.\\pipe\\crm-test-'+randomUUID():path;
