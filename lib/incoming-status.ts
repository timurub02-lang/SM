import type {IncomingRequest} from './crm.ts';
export function incomingIsMissed(item:Pick<IncomingRequest,'missedUntil'|'closedAt'|'spam'>,now=Date.now()){
 return !item.closedAt&&!item.spam&&Date.parse(item.missedUntil||'')>now;
}
export function incomingCounts(items:IncomingRequest[],now=Date.now()){
 const open=items.filter(i=>!i.closedAt&&!i.spam),missed=open.filter(i=>incomingIsMissed(i,now)).length;
 return {ready:open.length-missed,missed};
}
