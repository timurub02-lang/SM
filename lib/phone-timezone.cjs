'use strict';
const registry=require('../data/phone-timezones/ranges.json');
const formatters=new Map();
function localParts(now,zone){
 if(!formatters.has(zone))formatters.set(zone,new Intl.DateTimeFormat('en-GB',{timeZone:zone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
 const p=Object.fromEntries(formatters.get(zone).formatToParts(now).map(x=>[x.type,x.value]));
 return {day:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(p.weekday)+1,minute:Number(p.hour)*60+Number(p.minute)};
}
function resolvePhoneTimezone(value,now=new Date()){
 const raw=typeof value==='string'?value.replace(/[\s()+.-]/g,''):'';
 const number=/^[78]\d{10}$/.test(raw)?Number('7'+raw.slice(1)):NaN;
 if(!Number.isFinite(number))return {status:'invalid',zones:[],asOf:registry.asOf};
 // A stale directory must be visible, not silently treated as a trustworthy timezone.
 const age=now.getTime()-Date.parse(registry.asOf+'T00:00:00Z');
 if(!Number.isFinite(age)||age<0||age>=90*86400000)return {status:'stale',zones:[],asOf:registry.asOf};
 let lo=0,hi=registry.ranges.length-1,found;
 while(lo<=hi){const mid=(lo+hi)>>1,r=registry.ranges[mid];if(number<r[0])hi=mid-1;else if(number>r[1])lo=mid+1;else{found=r;break;}}
 const zones=found?found[2].map(i=>registry.zones[i]):[];
 return {status:zones.length===1?'resolved':zones.length?'multiple':'unknown',zones,asOf:registry.asOf};
}
function minutes(s){if(typeof s!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(s))throw Error('Invalid call window');return Number(s.slice(0,2))*60+Number(s.slice(3));}
function callTimeDecision(number,policy,now=new Date()){
 const resolved=resolvePhoneTimezone(number,now);
 if(!resolved.zones.length)return {...resolved,allowed:false,reason:'timezone_'+resolved.status};
 try{
  const from=minutes(policy.clientWindow.from),to=minutes(policy.clientWindow.to);
  if(from>=to||policy.timezone!=='Europe/Moscow'||!Array.isArray(policy.schedule)||!policy.schedule.length)throw Error('Invalid schedule');
  const periods=policy.schedule.map(s=>{const start=minutes(s.from),end=minutes(s.to);if(!Number.isInteger(s.day)||s.day<1||s.day>7||start>=end)throw Error('Invalid schedule');return {...s,start,end};});
  const project=localParts(now,'Europe/Moscow');
  if(!periods.some(s=>s.day===project.day&&project.minute>=s.start&&project.minute<s.end))return {...resolved,allowed:false,reason:'project_closed'};
  // Multi-region ranges may be dialled only in the shared allowed window.
  const allowed=resolved.zones.every(z=>{const t=localParts(now,z).minute;return t>=from&&t<to;});
  return {...resolved,allowed,reason:allowed?'allowed':'client_closed'};
 }catch{return {...resolved,allowed:false,reason:'invalid_policy'};}
}
module.exports={resolvePhoneTimezone,callTimeDecision};
