// All independent synthetic unit suites, including ones formerly omitted from CI.
import {readdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
const files=readdirSync('tests').filter(f=>(f.endsWith('.mjs')||f.endsWith('.test.ts'))&&!f.endsWith('-http.mjs')&&!['run-units.mjs','phone-timezone-sql.mjs'].includes(f)).sort();
let next=0,passed=0;const failures=[];
async function worker(){while(next<files.length){const file=files[next++];await new Promise(resolve=>{
 const child=spawn(process.execPath,['--experimental-strip-types','tests/'+file],{stdio:['ignore','pipe','pipe']});let output='';
 const timer=setTimeout(()=>child.kill(),90000);
 child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
 child.on('error',e=>output+=e.message);
 child.on('close',code=>{clearTimeout(timer);if(code===0)passed++;else{failures.push(file);console.error(file+'\n'+output);}resolve();});
 });}}
await Promise.all(Array.from({length:3},worker));
console.log(`${passed}/${files.length} synthetic unit suites passed.`);
if(failures.length){console.error('Failed: '+failures.join(', '));process.exitCode=1;}
