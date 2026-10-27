type CallMicrophone={mute:()=>unknown;unmute:()=>unknown;isMuted:()=>boolean;localMediaStream?:{getAudioTracks:()=>{enabled:boolean;readyState:string}[]}};
export function setCallMicrophoneMuted(phone:CallMicrophone,muted:boolean){
 const tracks=phone.localMediaStream?.getAudioTracks().filter(t=>t.readyState==='live')||[];
 if(!tracks.length)throw Error('No live microphone');
 // SIP.js ignores mute before Established. Never report success just from a click.
 if(muted)phone.mute();else phone.unmute();
 if(phone.isMuted()!==muted)throw Error('Microphone command was not applied');
 tracks.forEach(track=>{track.enabled=!muted;});
 if(tracks.some(track=>track.enabled===muted))throw Error('Microphone state not confirmed');
 return muted;
}
