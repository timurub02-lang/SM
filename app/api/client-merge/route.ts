import {z} from 'zod';
import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {mergePreview,mergeClients} from '@/lib/client-merge';
const schema=z.object({ids:z.array(z.string().min(1).max(100)).min(2).max(10),action:z.enum(['preview','merge']),ownerClientId:z.string().optional(),phone:z.string().optional(),revision:z.string().optional()});
export const POST=authenticated(async req=>{
 const employee=(await getChatGPTUser())?.employee;
 if(employee?.role!=='admin')return Response.json({error:'Объединение доступно только администратору'},{status:403});
 try{
  const p=schema.parse(await req.json());
  if(p.action==='preview')return Response.json(await mergePreview(db(),p.ids));
  if(!p.ownerClientId||!p.phone||!p.revision)throw Error('Сначала проверьте сравнение и выберите владельца и телефон');
  return Response.json(await mergeClients(db(),{ids:p.ids,ownerClientId:p.ownerClientId,phone:p.phone,revision:p.revision},employee.id));
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось объединить карточки'},{status:409});}
});
