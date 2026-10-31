// Loaded only by review-http.mjs into its synthetic standalone child process.
// Simulate another writer committing between an application precheck and its write.
const {DatabaseSync}=require('node:sqlite');
const {readFileSync,unlinkSync}=require('node:fs');
const prepare=DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare=function(sql){
 const database=this,statement=prepare.call(database,sql);
 return new Proxy(statement,{get(target,key){
  const value=Reflect.get(target,key);
  if(typeof value!=='function')return value;
  if(!['get','all','run'].includes(key))return value.bind(target);
  return (...args)=>{
   let plan;
   try{plan=JSON.parse(readFileSync(process.env.CRM_TEST_RACE_FILE,'utf8'));}catch{}
   const match=plan&&key===plan.method&&sql.includes(plan.match);
   if(match)unlinkSync(process.env.CRM_TEST_RACE_FILE);
   if(match&&plan.when==='before')database.exec(plan.sql);
   const result=value.apply(target,args);
   if(match&&plan.when==='after')database.exec(plan.sql);
   return result;
  };
 }});
};
