export type SearchableCdekPoint={code:string;address:string;workTime:string;sameStreet?:boolean;samePostalCode?:boolean;allowedCod?:boolean};
export function filterCdekPoints<T extends SearchableCdekPoint>(points:T[],query:string){
 const normalize=(value:string)=>value.toLocaleLowerCase('ru').replace(/ё/g,'е').trim();
 const words=normalize(query).split(/\s+/).filter(Boolean);
 return points.filter(point=>words.every(word=>normalize(point.code+' '+point.address).includes(word)));
}
