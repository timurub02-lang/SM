import {redirect} from 'next/navigation';
import {headers} from 'next/headers';
import {personalAuth,sessionEmployee} from '@/lib/auth';
import OktellProjects from '@/components/oktell-projects';
export const dynamic='force-dynamic';
export const metadata={title:'СМ · Проекты Oktell'};
export default async function Page(){
 if(process.env.OKTELL_PROJECT_SETTINGS!=='1')redirect('/oktell');
 if(!personalAuth())redirect('/login');
 const actor=await sessionEmployee(new Headers(await headers()));
 if(!actor)redirect('/login');
 if(actor.role!=='admin'||actor.impersonation)redirect('/');
 return <OktellProjects/>;
}
