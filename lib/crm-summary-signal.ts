import {createHash} from 'node:crypto';
import type {ActivityDb} from './activity-store.ts';
import {readPreparedModel} from './crm-read-model.ts';
import type {WorkspaceSummary} from './crm-workspace-summary.ts';

// SSE carries an opaque change token, never counters, record IDs or employee data.
// Freshness is checked on every read; unchanged re-publication timestamps are excluded.
export async function workspaceSummarySignal(d:ActivityDb,employeeId:string,sourceRevision:string,now=Date.now()){
 const model=await readPreparedModel<WorkspaceSummary>(d,'summary',employeeId,sourceRevision,now);
 return createHash('sha256').update(JSON.stringify([model.status,model.schemaVersion,model.sourceRevision,model.data])).digest('base64url');
}
