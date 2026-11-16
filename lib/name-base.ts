// Conflicting names and incomplete initials require human review.
const male=new Set('александр алексей анатолий андрей антон аркадий артем артемий артур борис вадим валентин валерий василий виктор виталий владимир владислав вячеслав геннадий георгий герман глеб григорий даниил денис дмитрий евгений егор иван игорь илья кирилл константин лев леонид макар максим марат марк матвей михаил никита николай олег павел петр роман руслан семен сергей станислав степан тимофей тимур федор эдуард юрий яков ярослав вахтанг динус марсель иосиф джамбулат оганес алик тлехберген расим умиджон бикян каирхан анас всеволод иннокентий рамиль магомед дамир кузьма савва фома венедикт вениамин'.split(' '));
const female=new Set('александра алена алина алла анастасия ангелина анжела анна антонина валентина валерия вера вероника виктория галина дарья диана евгения евдокия екатерина елена елизавета жанна зинаида зоя инна ирина ксения лариса лидия лилия любовь людмила маргарита марина мария надежда наталия наталья нелли нина оксана ольга полина раиса римма светлана софия софья таисия тамара татьяна ульяна юлия расима виолетта флюра резеда неля фаина варвара юналина клавдия нинель алевтина нэйля ираида майя зиляра зябет эльвира уркия лия альбина яиса роза лира фаиля найля фатима таися нонна васима люся ганна эмма олеся'.split(' '));
export function nameBase(value:string):'M'|'J'|null{
 const parts=value.toLowerCase().replaceAll('ё','е').replace(/[.,;:()«»“”"']/g,' ').replace(/(^|\s)[—–-]+(?=\s|$)/g,' ').trim().split(/\s+/).map(p=>p.replace(/^-+|-+$/g,''));
 if(parts.length>3||parts.some(p=>!(/^[а-я]+(?:-[а-я]+)*$/).test(p)||p.length<2||['нет','неизвестно','неизвестный','неизвестная','клиент'].includes(p)))return null;
 const names=new Set(parts.flatMap(p=>male.has(p)?['M' as const]:female.has(p)?['J' as const]:[]));
 if(names.size>1)return null;
 // Surnames can end in -ич, so a patronymic alone is used only in a full three-part name.
 const patronymicBase=(p:string)=>/(?:ович|евич|ич)$/.test(p)?'M':/(?:овна|евна|ична|инична)$/.test(p)?'J':null;
 const nameIndex=parts.findIndex(p=>male.has(p)||female.has(p));
 const following=nameIndex>=0?parts[nameIndex+1]:undefined;
 // Prefer the patronymic after a given name over surnames such as Денисевич.
 const candidates=parts.length===3&&following&&patronymicBase(following)?[following]:parts.filter(p=>!male.has(p)&&!female.has(p));
 const patronymics=new Set(candidates.flatMap(p=>{const base=patronymicBase(p);return base?[base]:[];}));
 if(patronymics.size>1)return null;
 const name=[...names][0],patronymic=[...patronymics][0];
 if(name&&patronymic&&name!==patronymic)return null;
 return name||(parts.length===3?patronymic:null)||null;
}
