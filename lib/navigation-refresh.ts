// Queue a refresh across a save or an open form; never increase periodic polling.
export class NavigationRefresh {
 private previous:{view:string;overlayOpen:boolean}|undefined;
 private pending=false;
 update(context:{view:string;overlayOpen:boolean;blocked:boolean}):boolean {
  if(this.previous&&(this.previous.view!==context.view||this.previous.overlayOpen&&!context.overlayOpen))this.pending=true;
  this.previous={view:context.view,overlayOpen:context.overlayOpen};
  if(!this.pending||context.blocked||context.overlayOpen)return false;
  this.pending=false;
  return true;
 }
}

// Evaluate at response time, not request time: a form may close during a slow GET.
export function preserveRefreshForm(background:boolean,formOpen:boolean){return background&&formOpen;}
