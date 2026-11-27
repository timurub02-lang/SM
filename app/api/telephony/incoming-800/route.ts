import {db} from '@/lib/db';
import {incoming800Http} from '@/lib/incoming-800';
export const dynamic='force-dynamic';
export async function POST(req:Request){return incoming800Http(req,db);}
