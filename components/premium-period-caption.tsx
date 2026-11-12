import {premiumPeriods} from '@/lib/premium-periods';

export function PremiumPeriodCaption({periodId,preview}:{periodId?:string;preview:boolean}){
 const period=premiumPeriods.find(p=>p.id===periodId);
 const date=(value:string)=>value.split('-').reverse().join('.');
 return <p className="next-premium-period">
  {period?<><strong>{period.label}</strong><br/>Поступления: {date(period.from)} — {date(period.cutoff)} включительно · Выплата: {date(period.payout)}.
   {preview&&<><br/>Предварительная выплата за следующий период.</>}
  </>:preview?'Следующий период пока не определён.':'Текущий период пока не определён.'}
 </p>;
}
