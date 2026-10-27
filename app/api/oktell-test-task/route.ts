export const dynamic='force-dynamic';
function retired(){return Response.json({error:'Прежний раздел Oktell закрыт. Откройте раздел заново.',redirect:'/oktell'},{status:410,headers:{'Cache-Control':'no-store'}});}
export const GET=retired;
export const POST=retired;
