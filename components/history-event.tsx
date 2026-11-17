import {stamp,type Event} from '@/lib/crm';
import {historyPresentation} from '@/lib/history-presentation';
export function HistoryEvent({event}:{event:Event}){
 const {summary,details}=historyPresentation(event.text);
 const heading=<><span style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{summary}</span><small style={{display:'block'}}>{stamp(event.at,'Europe/Moscow')} МСК · {event.actor}</small></>;
 return <div className="history-event"><span className="history-dot"/>{details?<details style={{minWidth:0,width:'100%'}}><summary style={{cursor:'pointer'}}>{heading}</summary><div style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',marginTop:12}}>{details}</div></details>:<div>{heading}</div>}</div>;
}
