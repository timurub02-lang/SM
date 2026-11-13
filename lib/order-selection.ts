export function updateOrderSelection(current:string[],ids:string[],checked:boolean){
 const affected=new Set(ids);
 return checked?[...new Set([...current,...ids])]:current.filter(id=>!affected.has(id));
}
