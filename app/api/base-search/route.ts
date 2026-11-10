import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {initBaseStorage} from '@/lib/base-storage';
import {searchBaseClients} from '@/lib/base-client-search';
export const dynamic='force-dynamic';
export const GET=authenticated(async req=>{
 const employee=(await getChatGPTUser())?.employee;
 if(employee?.role!=='admin')return Response.json({error:'Поиск доступен только администратору'},{status:403});
 try{
  await initBaseStorage(db());
  return Response.json(await searchBaseClients(db(),new URL(req.url).searchParams.get('q')||''),{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось найти клиента'},{status:400});}
});
