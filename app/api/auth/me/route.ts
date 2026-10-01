import {getChatGPTUser} from '@/app/chatgpt-auth';
import {personalAuth} from '@/lib/auth';
export async function GET(){
 const user=await getChatGPTUser();
 if(!user)return Response.json({error:'Требуется вход'},{status:401,headers:{'Cache-Control':'no-store'}});
 return Response.json({employee:user.employee?{id:user.employee.id,name:user.employee.name,login:user.employee.login,role:user.employee.role,department:user.employee.department}:null,personalAuth:personalAuth()},{headers:{'Cache-Control':'no-store'}});
}
