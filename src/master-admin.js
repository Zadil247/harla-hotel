import { requestNumberLabel } from './request-number.js';
import { Navbar, AdminServiceNav } from './components.js';
import { images, siteConfig } from './data.js';
import { getSupabaseClient } from './supabase-client.js';
import { escapeHtml as esc, wireRestaurantNav } from './restaurant-admin-ui.js';

const app = document.querySelector('#master-admin-app');
const loginPage = location.pathname.includes('master-admin-login');
const state = { profile: null, data: null, settings: null, history: [], counters: [], filter: 'all', search: '', tab: 'overview', busy: false, refreshing: false };
const date = value => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Africa/Addis_Ababa', dateStyle: 'medium', timeStyle: 'short' }) : 'Not scheduled';
const label = value => String(value || 'pending').replaceAll('_', ' ');
const statusText = message => { const target = document.querySelector('#master-status'); if (target) target.textContent = message; };
async function request(action, payload = {}, binary = false) {
  const { data } = await (await getSupabaseClient()).auth.getSession();
  if (!data.session) throw Object.assign(new Error('Please sign in with your Master Admin account.'), { status: 403 });
  const result = await fetch('/api/room-admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ scope: 'manager', action, ...payload }), signal: AbortSignal.timeout(60000) });
  if (binary && result.ok) return result.blob();
  const json = await result.json();
  if (!result.ok) throw Object.assign(new Error(json.error || 'Request failed.'), { status: result.status });
  return json;
}
function shell(content) {
  app.innerHTML = `${Navbar()}<main class="admin-shell master-admin-shell" id="master-main"><section class="admin-hero"><div><p class="eyebrow">Hotel Management</p><h1>Harla Hotel Master Admin</h1><p>${loginPage ? 'One secure view of your hotel, restaurant, events and tours.' : 'Follow bookings, orders and team decisions. Keep every department in view.'}</p></div><img src="${images.logo}" alt="${siteConfig.brandName} logo" /></section>${content}<p id="master-status" class="admin-status" role="status" aria-live="polite"></p></main>`;
  wireRestaurantNav();
}
function login(message = '') {
  shell(`<section class="admin-login admin-card"><div><p class="eyebrow">Protected Access</p><h2>Sign in as Master Admin</h2><p>Use your existing authorized management account. Department staff accounts have access to their own service.</p></div><form id="master-login" class="booking-form"><div class="form-grid"><label>Email<input name="email" type="email" autocomplete="username" required /></label><label>Password<input name="password" type="password" autocomplete="current-password" required /></label></div><button class="btn btn-primary">Sign In</button><p class="form-status" role="status">${esc(message)}</p></form></section>`);
  document.querySelector('#master-login').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button'), values = new FormData(form);
    button.disabled = true; const status = form.querySelector('.form-status'); status.textContent = 'Signing in…';
    try {
      const { error } = await (await getSupabaseClient()).auth.signInWithPassword({ email: String(values.get('email')).trim(), password: String(values.get('password')) });
      if (error) throw error;
      await request('profile'); location.replace('./master-admin.html');
    } catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
  });
}
function render() {
  shell(`<section class="admin-toolbar"><span class="admin-user">${esc(state.profile.full_name || state.profile.email)}</span><a href="./index.html" class="btn btn-light" target="_blank" rel="noopener">View Website</a><a class="btn btn-light" href="./admin-account.html?service=master">Account Settings</a><button class="btn btn-light" data-signout>Sign Out</button></section><section class="admin-panel master-departments"><div><p class="eyebrow">Department Access</p><h2>Open an admin dashboard</h2><p>Your management login works across all three departments. Each opens in a new tab.</p></div>${AdminServiceNav('master')}</section><nav class="master-tabs" aria-label="Management views"><button data-tab="overview" class="btn ${state.tab === 'overview' ? 'btn-primary' : 'btn-light'}">Live Overview</button><button data-tab="reports" class="btn ${state.tab === 'reports' ? 'btn-primary' : 'btn-light'}">Reports &amp; Email Schedule</button><button data-tab="numbering" class="btn ${state.tab === 'numbering' ? 'btn-primary' : 'btn-light'}">Request Numbering</button></nav><div id="master-content">${state.tab === 'overview' ? overview() : state.tab === 'numbering' ? numbering() : reports()}</div>`);
  document.querySelector('[data-signout]').onclick = async () => { await (await getSupabaseClient()).auth.signOut(); location.replace('./master-admin-login.html'); };
  document.querySelectorAll('[data-tab]').forEach(button => button.onclick = async () => {
    state.tab = button.dataset.tab;
    if (state.tab === 'reports') {
      try { const data = await request('settings'); state.settings = data.settings; state.history = data.history; } catch (error) { statusText(error.message); return; }
    }
    if (state.tab === 'numbering') {
      try { state.counters = (await request('numbering')).counters; } catch (error) { statusText(error.message); return; }
    }
    render();
  });
  wireContent();
}
function overview() {
  const data = state.data;
  if (!data) return '<section class="admin-card"><p>Loading hotel activity…</p></section>';
  return `<section class="master-metrics" aria-label="Records by service">${data.sources.map(source => `<button class="master-metric ${state.filter === source.key ? 'is-active' : ''}" data-service="${source.key}"><strong>${source.count}</strong><span>${source.label}</span><small>All retained records</small></button>`).join('')}</section><section class="admin-panel"><div class="admin-panel-heading"><div><p class="eyebrow">Live Activity</p><h2>Across the hotel</h2><p id="master-live-status">Updates every 10 seconds · Last updated ${esc(date(data.refreshed_at))} · Ethiopia time</p></div><button class="btn btn-light" data-refresh>Refresh Now</button></div><div class="master-feed" id="master-feed">${activityRows()}</div></section><section class="admin-panel"><div class="admin-panel-heading"><div><p class="eyebrow">Bookings, Orders &amp; Enquiries</p><h2>Latest records</h2></div><div class="master-filters"><label>Service<select id="master-service"><option value="all">All services</option>${data.sources.map(source => `<option value="${source.key}" ${state.filter === source.key ? 'selected' : ''}>${source.label}</option>`).join('')}</select></label><label>Search<input id="master-search" type="search" value="${esc(state.search)}" placeholder="Customer, reference or phone" /></label></div></div><p>Showing the latest 40 records per service. Open a department for approvals and full booking details.</p><div id="master-records" class="master-record-grid">${recordRows()}</div></section>`;
}
function activityRows() {
  return state.data.activity.length ? state.data.activity.slice(0, 50).map(item => `<article class="master-activity"><span class="master-activity-dot" aria-hidden="true"></span><div><strong>${esc(item.service)} · ${esc(label(item.action))}</strong><p>${esc(item.customer_name)} <span class="master-reference">${esc(item.reference)}</span></p><small>${esc(item.actor_email || 'Customer / automated system')}${item.previous_status ? ` · ${esc(label(item.previous_status))} → ${esc(label(item.status))}` : ''}</small></div><time datetime="${esc(item.created_at)}">${esc(date(item.created_at))}</time></article>`).join('') : '<p class="empty-state">No new activity yet. Customer requests and staff actions will appear here automatically.</p>';
}
function recordRows() {
  const query = state.search.toLowerCase().trim();
  const rows = state.data.sources.filter(source => state.filter === 'all' || source.key === state.filter).flatMap(source => source.records.map(record => ({ ...record, service: source.label, key: source.key }))).filter(row => !query || [row.name, row.reference, row.phone].some(value => String(value || '').toLowerCase().includes(query))).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return rows.length ? rows.map(row => `<article class="admin-order-card master-record"><p class="eyebrow">${esc(row.service)}</p><h3>${esc(row.name)}</h3><p class="master-reference">${esc(requestNumberLabel(row))}<br>${esc(row.reference)}</p><span class="status-pill">${esc(label(row.status))}</span><dl class="admin-order-details"><div><dt>Received</dt><dd>${esc(date(row.created_at))}</dd></div><div><dt>Contact</dt><dd>${esc(row.phone || '—')}${row.email ? `<br>${esc(row.email)}` : ''}</dd></div>${row.amount !== null ? `<div><dt>Recorded value</dt><dd>${Number(row.amount).toLocaleString('en-US')} ${esc(row.currency)}</dd></div>` : ''}${row.payment_status ? `<div><dt>Payment</dt><dd>${esc(label(row.payment_status))}</dd></div>` : ''}</dl>${row.kitchen === 'entered' ? '<p>Sent to kitchen</p>' : ''}${row.details ? `<p>${esc(row.details)}</p>` : ''}</article>`).join('') : '<p class="empty-state">No records match this view.</p>';
}
function reports() {
  const s = state.settings;
  if (!s) return '<p>Loading report settings…</p>';
  const options = (values, selected) => values.map(([value, text]) => `<option value="${value}" ${String(value) === String(selected) ? 'selected' : ''}>${text}</option>`).join('');
  return `<section class="admin-panel"><div class="admin-panel-heading"><div><p class="eyebrow">Excel Reports</p><h2>Your hotel, in one workbook</h2></div><span class="status-pill">${s.enabled ? 'Email delivery enabled' : 'Email delivery paused'}</span></div><p>Includes rooms, restaurant orders, VIP dining, events, tours, enquiries and staff activity. Each workbook includes a summary and comparison with the preceding period. Values represent requests and quotes, not collected revenue.</p><div class="master-download"><label>Download a completed period<select id="download-frequency"><option value="daily">Yesterday</option><option value="weekly" selected>Previous full week (Monday–Sunday)</option><option value="monthly">Previous calendar month</option></select></label><button class="btn btn-primary" data-download>Download Excel</button></div></section><section class="admin-panel"><p class="eyebrow">Email Schedule</p><h2>Choose when management hears from Harla</h2><form id="report-settings" class="booking-form"><div class="form-grid"><label>General manager’s report email<input type="email" name="recipient_email" value="${esc(s.recipient_email || '')}" placeholder="Enter the manager’s email" maxlength="254" /></label><label>Excel report frequency<select name="frequency">${options([['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']], s.frequency)}</select></label><label>Send time · Ethiopia (UTC+03:00)<input type="time" name="send_time" value="${esc(s.send_time)}" required /></label><label>Weekly delivery day<select name="weekday">${options([[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday']], s.weekday)}</select></label><label>Monthly delivery day<input type="number" name="month_day" min="1" max="31" value="${s.month_day}" required /></label><label>Additional management summary<select name="summary_frequency">${options([['off', 'Off'], ['weekly', 'Weekly'], ['monthly', 'Monthly']], s.summary_frequency)}</select></label></div><label class="master-checkbox"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''} />Enable scheduled email delivery</label><p>Reports cover the previous completed day, Monday–Sunday week, or calendar month. Summaries use the same send time and weekly/monthly day. Delivery begins within five minutes of the selected time. Days beyond the end of a month use its last day.</p><p>Next Excel report: <strong>${esc(date(s.next_report_at))}</strong><br>Next management summary: <strong>${esc(date(s.next_summary_at))}</strong></p><div class="admin-actions"><button class="btn btn-primary" type="submit">Save Report Settings</button><button class="btn btn-light" type="button" data-send-now ${s.recipient_email ? '' : 'disabled'}>Email a Report Now</button></div><p class="form-status" role="status"></p></form></section><section class="admin-panel"><div class="admin-panel-heading"><div><p class="eyebrow">Delivery History</p><h2>Recent reports</h2></div><button class="btn btn-light" data-history>Refresh History</button></div>${state.history.length ? `<div class="master-history">${state.history.map(run => `<article class="master-history-row"><div><strong>${esc(label(run.kind))} · ${esc(run.status === 'sent' ? 'Accepted by email provider' : label(run.status))}</strong><p>${esc(run.recipient_email)} · ${esc(date(run.created_at))}</p>${run.error ? `<p class="is-error">${esc(run.error)}</p>` : ''}</div>${run.file_path ? `<button class="btn btn-light" data-run="${esc(run.id)}">Download Excel</button>` : ''}</article>`).join('')}</div>` : '<p class="empty-state">No email reports yet. Save the recipient and schedule to begin.</p>'}</section>`;
}
async function withButton(button, task) {
  if (button.disabled) return;
  button.disabled = true;
  try { await task(); } catch (error) { statusText(error.message); } finally { if (button.isConnected) button.disabled = false; }
}
function numbering() {
  return `<section class="admin-panel"><p class="eyebrow">Request Numbering</p><h2>Start a new series at 1</h2><p>New requests receive a number within their service. Resetting starts a new series; it keeps every existing booking, payment reference, report and activity entry. Previous records retain their series and number. Records received before numbering was enabled show “Earlier record”.</p><p>After setting up your staff logins, reset the services you want to start fresh.</p><div class="master-record-grid">${state.counters.map(counter => `<article class="admin-order-card"><h3>${esc(state.data.sources.find(source => source.key === counter.service)?.label || counter.service)}</h3><p>Current series: <strong>${counter.series}</strong><br>Next request: <strong>#${counter.next_number}</strong><br>Started: ${esc(date(counter.started_at))}</p><form class="booking-form" data-reset-numbering="${counter.service}"><label>Type RESET to start a new series<input name="confirmation" autocomplete="off" pattern="RESET" required /></label><button class="btn btn-light" type="submit">Restart at 1</button></form></article>`).join('')}</div></section>`;
}
function wireContent() {
  document.querySelectorAll('[data-reset-numbering]').forEach(form => form.addEventListener('submit', event => {
    event.preventDefault();
    const service = form.dataset.resetNumbering, counter = state.counters.find(item => item.service === service);
    withButton(form.querySelector('button'), async () => {
      await request('reset_numbering', { service, series: counter.series, confirmation: form.elements.confirmation.value });
      state.counters = (await request('numbering')).counters; render(); statusText('New numbering series started. The next request for this service will be #1. Existing records are preserved.');
    });
  }));
  document.querySelector('[data-refresh]')?.addEventListener('click', () => refresh(true));
  document.querySelectorAll('[data-service]').forEach(button => button.onclick = () => { state.filter = button.dataset.service; updateOverview(); });
  document.querySelector('#master-service')?.addEventListener('change', event => { state.filter = event.target.value; document.querySelector('#master-records').innerHTML = recordRows(); });
  document.querySelector('#master-search')?.addEventListener('input', event => { state.search = event.target.value; document.querySelector('#master-records').innerHTML = recordRows(); });
  document.querySelector('[data-download]')?.addEventListener('click', event => withButton(event.currentTarget, async () => {
    statusText('Preparing Excel report…'); const frequency = document.querySelector('#download-frequency').value;
    const blob = await request('download', { frequency }, true); const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = `Harla-${frequency}-report.xlsx`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); statusText('Excel report downloaded.');
  }));
  document.querySelector('#report-settings')?.addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget, values = Object.fromEntries(new FormData(form)); values.enabled = form.elements.enabled.checked;
    withButton(form.querySelector('[type="submit"]'), async () => { const result = await request('save_settings', { settings: values, revision: state.settings.revision }); state.settings = result.settings; render(); statusText('Report settings saved.'); });
  });
  document.querySelector('[data-send-now]')?.addEventListener('click', event => withButton(event.currentTarget, async () => { statusText('Preparing and sending the report…'); const result = await request('send_now', { requestId: crypto.randomUUID() }); await loadReports(); statusText(result.sent ? 'Report accepted by the email provider.' : 'The report is already being processed. Check delivery history.'); }));
  document.querySelector('[data-history]')?.addEventListener('click', event => withButton(event.currentTarget, loadReports));
  document.querySelectorAll('[data-run]').forEach(button => button.onclick = () => withButton(button, async () => { const result = await request('download_run', { id: button.dataset.run }); const anchor = document.createElement('a'); anchor.href = result.url; anchor.download = 'Harla-report.xlsx'; anchor.click(); }));
}
async function loadReports() { const result = await request('settings'); state.settings = result.settings; state.history = result.history; render(); }
function updateOverview() { document.querySelector('#master-content').innerHTML = overview(); wireContent(); }
async function refresh(manual = false) {
  if (state.refreshing || state.tab !== 'overview') return;
  state.refreshing = true;
  try {
    state.data = await request('dashboard');
    if (manual || !document.querySelector('#master-feed')) updateOverview();
    else {
      document.querySelector('#master-feed').innerHTML = activityRows();
      document.querySelector('#master-records').innerHTML = recordRows();
      document.querySelector('#master-live-status').textContent = `Updates every 10 seconds · Last updated ${date(state.data.refreshed_at)} · Ethiopia time`;
      document.querySelectorAll('[data-service]').forEach(button => { const source = state.data.sources.find(source => source.key === button.dataset.service); button.querySelector('strong').textContent = source.count; });
    }
    statusText('');
  } catch (error) {
    if (error.status === 403) { location.replace('./master-admin-login.html'); return; }
    statusText(`Live updates paused: ${error.message} The last received data remains visible.`);
  } finally { state.refreshing = false; }
}
function startupError(error) {
  if (error.status === 403) { location.replace('./master-admin-login.html'); return; }
  shell(`<section class="admin-card" role="alert"><h2>Dashboard could not load</h2><p>${esc(error.message || 'Please try again.')}</p><div class="admin-actions"><button class="btn btn-primary" type="button" data-retry-startup>Try Again</button><a class="btn btn-light" href="./master-admin-login.html">Back to Sign In</a></div></section>`);
  document.querySelector('[data-retry-startup]').onclick = () => init();
}
async function init() {
  if (loginPage) {
    login(); let editing = false; document.querySelector('#master-login').addEventListener('input', () => { editing = true; }, { once: true });
    try { await request('profile'); if (!editing) location.replace('./master-admin.html'); } catch { /* Leave the login form available. */ }
    return;
  }
  shell('<section class="admin-card"><p>Checking management access…</p></section>');
  try { state.profile = (await request('profile')).profile; state.data = await request('dashboard'); render(); }
  catch (error) { startupError(error); return; }
  setInterval(() => { if (!document.hidden) refresh(); }, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}
init();
