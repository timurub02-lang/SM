import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {reviewPage,writeReview} from '@/lib/call-reviews';
import {canReviewCalls} from '@/lib/call-review-access';
import {z} from 'zod';
export const dynamic='force-dynamic';
export const GET=authenticated(async req=>{
  const actor=(await getChatGPTUser())?.employee;
  if(!canReviewCalls(actor))return Response.json({error:'Прослушка недоступна'},{status:403});
  return Response.json(await reviewPage(db(),new URL(req.url).searchParams),{headers:{'Cache-Control':'private, no-store'}});
});
const input=z.object({id:z.string().regex(/^[a-f0-9]{32}$/),source:z.enum(['phone','masked']),note:z.string().trim().max(3000),revision:z.string().uuid().nullable()});
export const POST=authenticated(async req=>{
  const actor=(await getChatGPTUser())?.employee;
  if(!actor||!canReviewCalls(actor))return Response.json({error:'Прослушка недоступна'},{status:403});
  const parsed=input.safeParse(await req.json());
  if(!parsed.success)return Response.json({error:'Проверьте запись и комментарий (до 3000 символов)'},{status:400});
  const {source,id,note,revision}=parsed.data;
  const saved=await writeReview(db(),source,id,note,revision,actor);
  return saved?Response.json({ok:true}):Response.json({error:'Запись изменилась. Обновите список и проверьте комментарий.'},{status:409});
});
