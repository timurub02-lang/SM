import JsBarcode from 'jsbarcode';

type Encoding={data:string};
export function postalBarcode(number:string){
 const output:{encodings?:Encoding[]}={};
 JsBarcode(output,number,{format:/^\d{14}$/.test(number)?'ITF':'CODE128',displayValue:false});
 return output.encodings!.map(encoding=>encoding.data).join('');
}
