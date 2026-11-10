// Conservative import hint: unfamiliar names and initials require human review.
const male=new Set('александр алексей анатолий андрей антон аркадий артем артемий артур борис вадим валентин валерий василий виктор виталий владимир владислав вячеслав геннадий георгий герман глеб григорий даниил денис дмитрий евгений егор иван игорь илья кирилл константин лев леонид макар максим марат марк матвей михаил никита николай олег павел петр роман руслан семен сергей станислав степан тимофей тимур федор эдуард юрий яков ярослав'.split(' '));
const female=new Set('александра алена алина алла анастасия ангелина анжела анна антонина валентина валерия вера вероника виктория галина дарья диана евгения евдокия екатерина елена елизавета жанна зинаида зоя инна ирина ксения лариса лидия лилия любовь людмила маргарита марина мария надежда наталия наталья нелли нина оксана ольга полина раиса римма светлана софия софья таисия тамара татьяна ульяна юлия'.split(' '));
export function nameBase(value:string):'M'|'J'|null{
 const parts=value.toLowerCase().replaceAll('ё','е').trim().split(/\s+/);
 if(parts.length<2||parts.length>3||parts.some(p=>!/^[а-я-]+$/.test(p)))return null;
 // Full names are surname, given name, patronymic; never guess from surname endings.
 const name=parts[1],gender=male.has(name)?'M':female.has(name)?'J':null;
 if(!gender)return null;
 if(parts.length===3){const patronymic=parts[2],pg=/(вич|ьич|ич)$/.test(patronymic)?'M':/(вна|чна)$/.test(patronymic)?'J':null;if(pg!==gender)return null;}
 return gender;
}
