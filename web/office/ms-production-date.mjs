// JSON API MoySklad timestamps are represented without timezone (MSK, UTC+03).
// Business time is Europe/Samara (UTC+04, with no DST): +1h to API's MSK wall time.
// Preserve day-only strings without shifting them.
export function formatMsMomentForSamara(value){
  if(typeof value!=='string')return '—';
  const m=value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?)?$/);
  if(!m)return '—';
  const [y,mo,d,hh,mi,ss]=m.slice(1);
  const year=Number(y),month=Number(mo),day=Number(d);
  if(month<1||month>12||day<1||day>31)return '—';
  if(hh==null)return d+'.'+mo+'.'+y;
  const hour=Number(hh),minute=Number(mi),second=Number(ss);
  if(hour>23||minute>59||second>59)return '—';
  const raw=new Date(Date.UTC(year,month-1,day,hour,minute,second));
  if(raw.getUTCFullYear()!==year||raw.getUTCMonth()!==month-1||raw.getUTCDate()!==day)return '—';
  const samara=new Date(raw.getTime()+3600000);
  const pad=n=>String(n).padStart(2,'0');
  return pad(samara.getUTCDate())+'.'+pad(samara.getUTCMonth()+1)+'.'+samara.getUTCFullYear()+
    ' '+pad(samara.getUTCHours())+':'+pad(samara.getUTCMinutes());
}
