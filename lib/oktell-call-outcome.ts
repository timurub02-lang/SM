// The browser SIP dialog may be answered by a PBX error announcement, not the callee.
// shortcut: until external-leg events are correlated, manual calls have no verified answer time.
export function manualOktellOutcome(browserStatus:string){
 const status=browserStatus==='connected'?'dialing':browserStatus==='ended'||browserStatus==='cancelled'?'unknown':browserStatus;
 const detail=browserStatus==='connected'?'гарнитура подключена к АТС; ответ абонента не подтверждён':status==='unknown'?'вызов завершён; ответ абонента не подтверждён':status==='dialing'?'идёт вызов; ответ абонента не подтверждён':'соединение с абонентом не подтверждено';
 return {status,answered:null,detail};
}
