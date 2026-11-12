import {createRequire} from 'node:module';
import {mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url),root=process.cwd(),target=path.resolve(process.argv[2]);
const {nodeFileTrace}=require('next/dist/compiled/@vercel/nft');
// ExcelJS uses runtime assets/dynamic requires; trace its actual dependency closure instead of bundling or copying all dependencies.
const {fileList}=await nodeFileTrace([require.resolve('exceljs')],{base:root,processCwd:root});
for(const file of fileList){
 if(!file.replaceAll('\\','/').startsWith('node_modules/'))throw Error('Unexpected external job dependency');
 const output=path.join(target,file);await mkdir(path.dirname(output),{recursive:true});await copyFile(path.join(root,file),output);
}
console.log(JSON.stringify({externalJobDependencyFiles:fileList.size}));
