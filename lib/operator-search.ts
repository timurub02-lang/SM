export function matchingOperators<T extends {name:string;login?:string}>(operators:T[],query:string){
 const words=query.trim().toLocaleLowerCase('ru').replaceAll('ё','е').split(/\s+/);
 return operators.filter(o=>{const text=[o.name,o.login||''].join(' ').toLocaleLowerCase('ru').replaceAll('ё','е');return words.every(w=>text.includes(w));});
}
