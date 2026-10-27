import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {personalAuth,sessionEmployee} from '@/lib/auth';
import OktellEmpty from '@/components/oktell-empty';

export const dynamic='force-dynamic';
export const metadata={title:'СМ · Oktell'};

export default async function Page(){
 if(!personalAuth())redirect('/login');
 const actor=await sessionEmployee(new Headers(await headers()),true);
 if(!actor)redirect('/login');
 if(!actor.testOnly&&actor.role!=='operator')redirect('/');
 if(!actor.testOnly)redirect('/?calls');
 return <OktellEmpty testOnly={!!actor.testOnly} operator={actor.role==='operator'}/>;
}
