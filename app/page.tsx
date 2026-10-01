import {getChatGPTUser} from '@/app/chatgpt-auth';
import {personalAuth} from '@/lib/auth';
import {redirect} from 'next/navigation';
import CrmApp from '@/components/crm-app';
export const dynamic='force-dynamic';
export default async function Page(){
 if(personalAuth()&&!await getChatGPTUser())redirect('/login');
 return <CrmApp/>;
}
