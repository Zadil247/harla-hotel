// Ethiopia uses UTC+03:00 throughout the year. Keep schedule calculations independent of server timezone.
const offset = 3 * 60 * 60 * 1000;
const local = date => new Date(new Date(date).getTime() + offset);
const utc = date => new Date(date.getTime() - offset);
const daysInMonth = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
export function nextOccurrence(settings, frequency, after = new Date()) {
  if (frequency === 'off') return null;
  const base = local(after);
  const [hour, minute] = settings.send_time.split(':').map(Number);
  let candidate = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour, minute));
  if (frequency === 'weekly') candidate.setUTCDate(candidate.getUTCDate() + (settings.weekday - candidate.getUTCDay() + 7) % 7);
  if (frequency === 'monthly') candidate.setUTCDate(Math.min(settings.month_day, daysInMonth(candidate.getUTCFullYear(), candidate.getUTCMonth())));
  if (candidate <= base) {
    if (frequency === 'daily') candidate.setUTCDate(candidate.getUTCDate() + 1);
    else if (frequency === 'weekly') candidate.setUTCDate(candidate.getUTCDate() + 7);
    else { candidate.setUTCDate(1); candidate.setUTCMonth(candidate.getUTCMonth() + 1); candidate.setUTCDate(Math.min(settings.month_day, daysInMonth(candidate.getUTCFullYear(), candidate.getUTCMonth()))); }
  }
  return utc(candidate).toISOString();
}
export function reportPeriod(frequency, at = new Date()) {
  const end = local(at); end.setUTCHours(0, 0, 0, 0);
  if (frequency === 'weekly') end.setUTCDate(end.getUTCDate() - (end.getUTCDay() + 6) % 7);
  if (frequency === 'monthly') end.setUTCDate(1);
  const start = new Date(end);
  if (frequency === 'monthly') start.setUTCMonth(start.getUTCMonth() - 1);
  else start.setUTCDate(start.getUTCDate() - (frequency === 'weekly' ? 7 : 1));
  return { start: utc(start).toISOString(), end: utc(end).toISOString() };
}
export function validateReportSettings(input) {
  const recipient_email = String(input.recipient_email || '').trim();
  const enabled = input.enabled === true;
  if (recipient_email && (recipient_email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient_email))) throw new Error('Enter a valid report email address.');
  if (enabled && !recipient_email) throw new Error('Enter the general manager’s email address before enabling delivery.');
  if (!['daily', 'weekly', 'monthly'].includes(input.frequency)) throw new Error('Choose a report frequency.');
  if (!['off', 'weekly', 'monthly'].includes(input.summary_frequency)) throw new Error('Choose a summary frequency.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.send_time || '')) throw new Error('Choose a valid send time.');
  const weekday = Number(input.weekday), month_day = Number(input.month_day);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !Number.isInteger(month_day) || month_day < 1 || month_day > 31) throw new Error('Choose a valid day.');
  return { recipient_email: recipient_email || null, enabled, frequency: input.frequency, summary_frequency: input.summary_frequency, send_time: input.send_time, weekday, month_day };
}
