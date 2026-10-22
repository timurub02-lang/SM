import {getChatGPTUser} from '@/app/chatgpt-auth';
import {personalAuth} from '@/lib/auth';
import {redirect} from 'next/navigation';
import OktellDemo from '@/components/oktell-demo';
export const dynamic='force-dynamic';
export const metadata={title:'СМ · Oktell · демо'};
export default async function Page(){
 if(personalAuth()){
  const user=await getChatGPTUser();
  if(!user)redirect('/login');
  if(!['admin','department_head'].includes(user.employee?.role||''))redirect('/');
 }
 return <OktellDemo/>;
}
