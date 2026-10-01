import type {AddressParts} from './address.ts';
type Point={code:string;address:string;postalCode?:string};
const words=(value:string)=>value.toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/пр-кт|пр-т/g,'проспект').replace(/[^а-яa-z0-9]+/g,' ').split(' ').filter(w=>w&&!['ул','улица','им','имени','проспект','пер','переулок','б','р','бульвар','наб','набережная','ш','шоссе'].includes(w));
export function rankRecipientPoints<T extends Point>(points:T[],address?:Partial<AddressParts>){
 const street=words(address?.street||'').join(' '),postal=address?.postalCode?.trim();
 return points.map(point=>{
  const sameStreet=!!street&&point.address.split(',').some(part=>` ${words(part).join(' ')} `.includes(` ${street} `));
  const pointPostal=point.postalCode||point.address.match(/(?:^|\D)(\d{6})(?!\d)/)?.[1];
  return {...point,sameStreet,samePostalCode:!!postal&&pointPostal===postal};
 }).sort((a,b)=>Number(b.sameStreet)-Number(a.sameStreet)||Number(b.samePostalCode)-Number(a.samePostalCode)||a.address.localeCompare(b.address,'ru',{numeric:true})||a.code.localeCompare(b.code));
}
