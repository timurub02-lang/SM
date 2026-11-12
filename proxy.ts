import {NextResponse,type NextRequest} from 'next/server';
import {legacySnapshotRequest,legacySnapshotWorker} from './lib/crm-legacy-proxy';

// The optional loopback process serves snapshots only; it never exposes mutation/integration routes.
export function proxy(request:NextRequest){
 if(!legacySnapshotWorker())return NextResponse.next();
 if(request.method==='GET'&&request.nextUrl.pathname==='/api/crm-worker-health')return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 if(legacySnapshotRequest(request))return NextResponse.next();
 return NextResponse.json({error:'Маршрут недоступен'},{status:403,headers:{'Cache-Control':'no-store'}});
}
