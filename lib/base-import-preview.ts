export type ImportReport={review:{key:string;row:number;phone:string;name:string}[];addedByBase:{M:number;J:number};fieldsUpdated?:number;added:number;moved:number;skipped:number;duplicates:number;invalid:{row:number;phone:string;reason:string}[];conflicts:{phone:string;clientId:string;name:string;baseType:string}[];applied:boolean;backupId?:string;previewRows?:{identities:string[];kind:'added'|'skipped'|'review';phone:string;destination?:'M'|'J'}[]};
export function emptyImportReport():ImportReport{return {added:0,moved:0,skipped:0,duplicates:0,invalid:[],conflicts:[],review:[],addedByBase:{M:0,J:0},applied:false};}
export function appendImportPreview(total:ImportReport,batch:ImportReport,seen:Set<string>):ImportReport{
 const next={...total,added:total.added+batch.added,moved:total.moved+batch.moved,skipped:total.skipped+batch.skipped,duplicates:total.duplicates+batch.duplicates,invalid:[...total.invalid,...batch.invalid],conflicts:[...total.conflicts,...batch.conflicts],review:[...total.review],addedByBase:{M:total.addedByBase.M+batch.addedByBase.M,J:total.addedByBase.J+batch.addedByBase.J}};
 // The server returns uncollapsed preview rows so linked phones are deduplicated across the whole file.
 const reviews=new Map<string,ImportReport['review'][number]>();for(const row of batch.review)if(!reviews.has(row.key))reviews.set(row.key,row);
 for(const row of batch.previewRows||[]){
  if(row.identities.some(id=>seen.has(id))){next.duplicates++;if(row.kind==='added'){next.added--;next.addedByBase[row.destination!]--;}else if(row.kind==='skipped')next.skipped--;}
  else {row.identities.forEach(id=>seen.add(id));if(row.kind==='review'){const review=reviews.get('new:'+row.phone);if(review)next.review.push(review);}}
 }
 return next;
}
