import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { requestingMasterAdmin } from './admin-auth.js';
import { getSupabaseAdmin } from './supabase-admin.js';
import { requiredEnv } from './config.js';
import { nextOccurrence, reportPeriod, validateReportSettings } from './manager-schedule.js';
import { activityColumns, reportSources, recordedValue, valueCurrency, collectReport, summarizeReport, buildWorkbook, reportMime } from './manager-reports.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const html = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function checked(result) { if (result.error) throw result.error; return result.data; }
async function settings(db) { return checked(await db.from('manager_report_settings').select('*').eq('id', 'default').single()); }
async function reportHistory(db) { return checked(await db.from('manager_report_runs').select('id,kind,period_start,period_end,recipient_email,status,attempts,file_path,error,created_at,sent_at').order('created_at', { ascending: false }).limit(30)); }
async function dashboard(db) {
  const sources = await Promise.all(reportSources.map(async source => {
    const result = await db.from(source.table).select(source.columns, { count: 'exact' }).order('created_at', { ascending: false }).limit(40);
    const rows = checked(result);
    return { key: source.key, label: source.label, count: result.count, records: rows.map(row => ({
      id: row.id, reference: row[source.ref], name: row[source.name], phone: row.phone, email: row.email,
      status: row.status, payment_status: row.payment_status, created_at: row.created_at,
      amount: ['rooms', 'restaurant', 'events'].includes(source.key) ? recordedValue(source.key, row) : null,
      currency: valueCurrency(source.key, row), kitchen: row.odoo_status,
      details: source.key === 'tours' ? [row.package_name, row.check_in, row.check_out, row.guests && `${row.guests} guests`, row.message].filter(Boolean).join(' · ')
        : source.key === 'tables' ? [row.reservation_date, row.reservation_time, row.guests && `${row.guests} guests`, row.message].filter(Boolean).join(' · ')
        : source.key === 'event_enquiries' ? [row.event_type, row.event_date, row.guests && `${row.guests} guests`, row.message].filter(Boolean).join(' · ') : '',
    })) };
  }));
  const activity = checked(await db.from('admin_activity').select(activityColumns).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100));
  return { sources, activity, refreshed_at: new Date().toISOString() };
}
async function schedulerAuthorized(db, request) {
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ') || header.length > 512) return false;
  const record = checked(await db.from('manager_scheduler_auth').select('token_hash').eq('id', 'default').maybeSingle());
  if (!record?.token_hash || !/^[a-f0-9]{64}$/.test(record.token_hash)) return false;
  return timingSafeEqual(createHash('sha256').update(header.slice(7)).digest(), Buffer.from(record.token_hash, 'hex'));
}
async function deliverReport(db, { key, kind, period, recipient }) {
  const rows = checked(await db.rpc('claim_manager_report', { p_key: key, p_kind: kind, p_start: period.start, p_end: period.end, p_recipient: recipient }));
  let run = rows?.[0];
  if (!run) {
    const existing = checked(await db.from('manager_report_runs').select('status,attempts').eq('idempotency_key', key).single());
    return { sent: existing.status === 'sent', status: existing.status, exhausted: existing.status === 'failed' && existing.attempts >= 5 };
  }
  try {
    // Resend retains idempotency keys for 24 hours. Never blindly repeat an ambiguous older send.
    if (run.attempts > 1 && Date.now() - new Date(run.created_at).getTime() > 23 * 3600000) throw new Error('Delivery needs review: the original attempt is over 23 hours old. Check the recipient inbox before sending another report.');
    let bytes, summary = run.summary;
    if (run.file_path && summary) {
      const file = checked(await db.storage.from('manager-reports').download(run.file_path));
      bytes = Buffer.from(await file.arrayBuffer());
    } else {
      const data = await collectReport(db, period.start, period.end);
      summary = summarizeReport(data); bytes = await buildWorkbook(data, summary);
      const path = `${run.id}.xlsx`;
      checked(await db.storage.from('manager-reports').upload(path, bytes, { contentType: reportMime, upsert: true }));
      checked(await db.from('manager_report_runs').update({ file_path: path, summary }).eq('id', run.id));
      run = { ...run, file_path: path };
    }
    const title = kind === 'summary' ? 'Management summary' : 'Management Excel report';
    const periodLabel = `${new Date(new Date(period.start).getTime() + 10800000).toISOString().slice(0, 10)} to ${new Date(new Date(period.end).getTime() + 10800000 - 1).toISOString().slice(0, 10)}`;
    const result = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${requiredEnv('RESEND_API_KEY')}`, 'Content-Type': 'application/json', 'Idempotency-Key': `harla-manager-${run.id}` },
      body: JSON.stringify({ from: process.env.HARLA_ROOM_EMAIL_FROM || requiredEnv('HARLA_EMAIL_FROM'), to: [run.recipient_email],
        subject: `Harla Hotel · ${title} · ${periodLabel}`,
        html: `<h1>Harla Hotel</h1><h2>${title}</h2><p>${periodLabel} · Ethiopia time</p>${summary.lines.map(line => `<p>${html(line)}</p>`).join('')}<p>The attached workbook contains the detailed records and activity log. Manage the schedule in Master Admin.</p>`,
        attachments: [{ filename: `Harla-${kind}-${periodLabel.replaceAll(' ', '-')}.xlsx`, content: bytes.toString('base64') }],
      }),
    });
    const sent = await result.json().catch(() => ({}));
    if (!result.ok || !sent.id) throw new Error(`Email provider did not accept the report (${result.status}).`);
    checked(await db.from('manager_report_runs').update({ status: 'sent', message_id: sent.id, sent_at: new Date().toISOString(), error: null }).eq('id', run.id));
    return { sent: true, id: run.id };
  } catch (error) {
    const saved = await db.from('manager_report_runs').update({ status: 'failed', error: String(error.message || 'Report failed.').slice(0, 500) }).eq('id', run.id);
    if (saved.error) console.error('Manager report failure could not be recorded', { code: saved.error.code });
    throw error;
  }
}
async function scheduledReports(db) {
  const config = await settings(db);
  if (!config.enabled || !config.recipient_email) return { processed: 0, reason: 'Delivery is disabled.' };
  const results = [];
  for (const [kind, field, frequency] of [['report', 'next_report_at', config.frequency], ['summary', 'next_summary_at', config.summary_frequency]]) {
    const due = config[field];
    if (frequency === 'off' || !due || new Date(due) > new Date()) continue;
    try {
      const result = await deliverReport(db, { key: `${config.revision}:${kind}:${due}`, kind, period: reportPeriod(frequency, due), recipient: config.recipient_email });
      if (result.sent || result.exhausted) checked(await db.from('manager_report_settings').update({ [field]: nextOccurrence(config, frequency) }).eq('id', 'default').eq('revision', config.revision).eq(field, due));
      results.push({ kind, ...result });
    } catch (error) { results.push({ kind, sent: false, error: error.message }); }
  }
  return { processed: results.length, results };
}
export async function masterAdminRequest(request, body) {
  const db = getSupabaseAdmin();
  try {
    if (body.action === 'scheduled_reports') {
      if (!await schedulerAuthorized(db, request)) return reply({ error: 'Scheduler authorization required.' }, 403);
      return reply(await scheduledReports(db));
    }
    const admin = await requestingMasterAdmin(db, request);
    if (!admin) return reply({ error: 'Active Master Admin access is required.' }, 403);
    if (body.action === 'profile') return reply({ profile: admin.masterProfile });
    if (body.action === 'dashboard') return reply(await dashboard(db));
    if (body.action === 'settings') return reply({ settings: await settings(db), history: await reportHistory(db) });
    if (body.action === 'save_settings') {
      let values;
      try { values = validateReportSettings(body.settings || {}); } catch (error) { return reply({ error: error.message }, 400); }
      const current = await settings(db);
      if (body.revision !== current.revision) return reply({ error: 'Report settings changed in another session. Reload them before saving.' }, 409);
      values = { ...values, revision: randomUUID(), updated_by: admin.id, updated_at: new Date().toISOString(),
        next_report_at: values.enabled ? nextOccurrence(values, values.frequency) : null,
        next_summary_at: values.enabled ? nextOccurrence(values, values.summary_frequency) : null };
      const updated = checked(await db.from('manager_report_settings').update(values).eq('id', 'default').eq('revision', current.revision).select('*').maybeSingle());
      if (!updated) return reply({ error: 'Report settings changed. Reload and try again.' }, 409);
      return reply({ settings: updated });
    }
    if (body.action === 'download') {
      if (!['daily', 'weekly', 'monthly'].includes(body.frequency)) return reply({ error: 'Choose a report period.' }, 400);
      const period = reportPeriod(body.frequency);
      const data = await collectReport(db, period.start, period.end);
      const bytes = await buildWorkbook(data);
      return new Response(bytes, { headers: { 'Content-Type': reportMime, 'Content-Disposition': `attachment; filename="Harla-${body.frequency}-report.xlsx"`, 'Cache-Control': 'no-store' } });
    }
    if (body.action === 'download_run') {
      const run = checked(await db.from('manager_report_runs').select('file_path').eq('id', String(body.id)).maybeSingle());
      if (!run?.file_path) return reply({ error: 'Report file is not available.' }, 404);
      const signed = checked(await db.storage.from('manager-reports').createSignedUrl(run.file_path, 120));
      return reply({ url: signed.signedUrl });
    }
    if (body.action === 'send_now') {
      const config = await settings(db);
      if (!config.recipient_email) return reply({ error: 'Save the manager’s report email address first.' }, 400);
      if (!/^[a-f0-9-]{36}$/.test(body.requestId || '')) return reply({ error: 'Invalid send request.' }, 400);
      return reply(await deliverReport(db, { key: `manual:${admin.id}:${body.requestId}`, kind: 'report', period: reportPeriod(config.frequency), recipient: config.recipient_email }));
    }
    return reply({ error: 'Choose a valid Master Admin action.' }, 400);
  } catch (error) {
    console.error('Master Admin action failed', { action: body.action, code: error.code, message: error.message });
    return reply({ error: 'The management request could not finish. Refresh and try again. Report delivery errors are recorded in delivery history.' }, 503);
  }
}
