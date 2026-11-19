import {mock} from 'node:test';
import {once} from 'node:events';

// Only the isolated HTTP test server preloads this module.
if(process.send)process.on('message',message=>{
 if(!message||!Object.hasOwn(message,'redemptionClock'))return;
 mock.timers.reset();
 if(message.redemptionClock!==null)mock.timers.enable({apis:['Date'],now:message.redemptionClock});
 process.send({redemptionClockReady:true});
});

export async function setRedemptionClock(server,time){
 const day=new Date(Date.now()+3*3600000).toISOString().slice(0,10);
 const reply=once(server,'message',{signal:AbortSignal.timeout(10000)});
 server.send({redemptionClock:time?Date.parse(day+'T'+time+'+03:00'):null});
 const [ack]=await reply;
 if(!ack?.redemptionClockReady)throw Error('Test server did not confirm the redemption clock');
}
