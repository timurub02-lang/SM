import {PDFDocument,PDFName,PDFNumber} from 'pdf-lib';
// Synthetic Cyrillic text with an explicit character map; no employee documents in Git.
export async function officialPdfFixture(){
 const lines=['Список перечисляемой в банк зарплаты','№ 1 от 20.11.2026 г.','1 Иванова Анна Петровна 11 484,00','2 Петрова Елена Ивановна 7 830,00','НДФЛ 3600','Итого 19 314,00'];
 const chars=[...new Set(lines.join(''))],code=c=>(chars.indexOf(c)+1).toString(16).padStart(2,'0');
 const pdf=await PDFDocument.create(),ctx=pdf.context,page=pdf.addPage([600,800]);
 const map=' /CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Test def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange '+chars.length+' beginbfchar '+chars.map(c=>'<'+code(c)+'> <'+c.charCodeAt(0).toString(16).padStart(4,'0')+'>').join('\n')+' endbfchar endcmap CMapName currentdict /CMap defineresource pop end end';
 const font=ctx.register(ctx.obj({Type:'Font',Subtype:'Type1',BaseFont:'Helvetica',FirstChar:1,LastChar:chars.length,Widths:chars.map(()=>PDFNumber.of(500)),ToUnicode:ctx.register(ctx.flateStream(map))}));
 page.node.set(PDFName.of('Resources'),ctx.obj({Font:{F1:font}}));
 page.node.set(PDFName.of('Contents'),ctx.register(ctx.flateStream(lines.map((line,i)=>'BT /F1 10 Tf 1 0 0 1 30 '+(760-i*20)+' Tm <'+[...line].map(code).join('')+'> Tj ET').join('\n'))));
 return Buffer.from(await pdf.save()).toString('base64');
}
