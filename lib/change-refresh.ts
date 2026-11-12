// Retain notifications received during writes or an in-flight read.
export class ChangeRefresh {
 private pending=false;
 private running=false;
 request(){this.pending=true;}
 async flush(blocked:()=>boolean,read:()=>Promise<boolean>){
  if(this.running)return;
  this.running=true;
  try{while(this.pending&&!blocked()){
   this.pending=false;
   try{if(!await read()){this.pending=true;break;}}
   catch(error){this.pending=true;throw error;}
  }}finally{this.running=false;}
 }
}
