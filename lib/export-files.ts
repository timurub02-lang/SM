import {dirname,join,resolve} from 'node:path';
import {mkdir,lstat,unlink,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {Readable} from 'node:stream';
export function exportDirectory(){const path=process.env.CRM_DATABASE_PATH;if(!path)throw Error('CRM_DATABASE_PATH is required');return resolve(process.env.CRM_EXPORT_DIRECTORY||join(dirname(path),'exports'));}
export function exportFile(id:string,claim:string,temp=false){if(!/^[a-f0-9-]{36}$/.test(id)||!/^[a-f0-9-]{36}$/.test(claim))throw Error('Invalid export identifier');return join(exportDirectory(),id+'.'+claim+(temp?'.tmp':'.xlsx'));}
export async function prepareExportDirectory(){const path=exportDirectory();await mkdir(path,{recursive:true,mode:0o700});if(!(await lstat(path)).isDirectory()||(await lstat(path)).isSymbolicLink())throw Error('Invalid export directory');return path;}
export async function readExportFile(id:string,claim:string){const file=await open(exportFile(id,claim),constants.O_RDONLY|constants.O_NOFOLLOW);try{if(!(await file.stat()).isFile())throw Error('Invalid export file');return Readable.toWeb(file.createReadStream()) as ReadableStream<Uint8Array>;}catch(error){await file.close();throw error;}}
export async function removeExportFile(id:string,claim:string){if(!claim)return;await unlink(exportFile(id,claim)).catch(error=>{if(error.code!=='ENOENT')throw error;});}
