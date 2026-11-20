import { formatMsMomentForSamara } from './ms-production-date.mjs';

// Calendar-day indicator ONLY for a task whose incomplete stages were verified.
// The planned date is not a contractual SLA or evidence of the responsible worker.
// MoySklad API date-times are MSK wall time (+03); the existing formatter converts
// them to Samara (+04). Date-only values are kept as business calendar dates.
export function classifyProductionPlanDate(task, audit, nowMs=Date.now()){
  if(audit?.status==='complete')return 'not_applicable';
  if(audit?.status!=='incomplete')return 'unverified';
  if(task?.plannedDate===null||task?.plannedDate===undefined||
    task.plannedDate==='')return 'not_set';
  if(typeof task.plannedDate!=='string'||!Number.isFinite(nowMs)||nowMs<0)
    return 'unverified';
  const formatted=formatMsMomentForSamara(task.plannedDate);
  const match=formatted.match(/^(\d{2})\.(\d{2})\.(\d{4})(?: \d{2}:\d{2})?$/);
  if(!match)return 'unverified';
  const [,dd,mm,yyyy]=match;
  // Reject impossible date-only values (e.g. 31 February) as well.
  const calendar=new Date(yyyy+'-'+mm+'-'+dd+'T00:00:00.000Z');
  if(!Number.isFinite(calendar.getTime())||
    calendar.toISOString().slice(0,10)!==yyyy+'-'+mm+'-'+dd)
    return 'unverified';
  const planned=yyyy+'-'+mm+'-'+dd;
  // Samara has fixed UTC+04:00 without daylight saving time.
  const today=new Date(nowMs+4*60*60*1000).toISOString().slice(0,10);
  return planned<today?'past':planned===today?'today':'future';
}
