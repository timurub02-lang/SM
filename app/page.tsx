import {getChatGPTUser} from '@/app/chatgpt-auth';
import {headers} from 'next/headers';
import {personalAuth,sessionEmployee} from '@/lib/auth';
import {redirect} from 'next/navigation';
import CrmApp from '@/components/crm-app';
export const dynamic='force-dynamic';
export default async function Page(){
 if(personalAuth()){const actor=await sessionEmployee(new Headers(await headers()),true);if(actor?.testOnly)redirect('/oktell-test');if(!await getChatGPTUser())redirect('/login');}
 return <CrmApp/>;
}
