// Used only by the synthetic HTTP/UI server, never imported by the application.
const realFetch=globalThis.fetch;
globalThis.fetch=async(input,options)=>{
 const url=String(input instanceof Request?input.url:input);
 if(url.startsWith('https://cc.crmcalls.ru/')){
  if(!url.includes('/api/v1/projects')||options?.method==='POST')throw Error('Unexpected CRMCalls test request');
  return Response.json({data:['Пассив','ТК AI','Ж2 ИИ','Ж1 ИИ','Т1 AI'].map((name,i)=>({id:i?'11111111-1111-4111-8111-11111111111'+(i+1):'11111111-1111-4111-8111-111111111111',name:name+' · тест',status:'draft'})),pagination:{total_pages:1}});
 }
 return realFetch(input,options);
};
