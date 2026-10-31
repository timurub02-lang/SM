export function byteRange(header:string|null,size:number):{start:number;end:number}|null{
 if(!header)return {start:0,end:size-1};
 const match=/^bytes=(\d*)-(\d*)$/.exec(header);
 if(!match||(!match[1]&&!match[2])||size===0)return null;
 const first=Number(match[1]),last=Number(match[2]);
 if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last))return null;
 const start=match[1]?first:Math.max(0,size-last),end=match[1]&&match[2]?Math.min(last,size-1):size-1;
 return start>=0&&start<=end?{start,end}:null;
}
