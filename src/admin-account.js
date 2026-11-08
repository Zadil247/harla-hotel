import { Navbar } from './components.js';
import { images } from './data.js';
import { getSupabaseClient } from './supabase-client.js';
import { escapeHtml as esc, wireRestaurantNav } from './restaurant-admin-ui.js';

const app = document.querySelector('#account-app');
const routes = { restaurant: ['restaurant-admin.html', 'restaurant-admin-login.html'], rooms: ['admin.html', 'admin-login.html'], events: ['event-admin.html', 'event-admin-login.html'], master: ['master-admin.html', 'master-admin-login.html'] };
const service = new URLSearchParams(location.search).get('service');
const route = routes[service] || routes.master;
let profile, departments = [];
async function request(action, values = {}) {
  const { data } = await (await getSupabaseClient()).auth.getSession();
  if (!data.session) throw Object.assign(new Error('Please sign in first.'), { status: 403 });
  const response = await fetch('/api/room-admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ scope: 'account', action, ...values }), signal: AbortSignal.timeout(45000) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Request failed.'), { status: response.status });
  return result;
}
function shell(content) {
  app.innerHTML = `${Navbar()}<main id="account-main" class="admin-shell"><section class="admin-hero"><div><p class="eyebrow">Staff Security</p><h1>Account Settings</h1><p>Choose your login details privately. Passwords are never displayed.</p></div><img src="${images.logo}" alt="Harla Hotel logo" /></section><section class="admin-toolbar"><a class="btn btn-light" href="./${route[0]}">Back to Dashboard</a></section>${content}</main>`;
  wireRestaurantNav();
}
function fields(email, creating = false) {
  return `<div class="form-grid"><label>Login email<input name="email" type="email" maxlength="254" autocomplete="off" value="${esc(email)}" required /></label><label>Confirm login email<input name="confirmEmail" type="email" maxlength="254" autocomplete="off" value="${esc(email)}" required /></label><label>${creating ? 'Password' : 'New password (leave blank to keep it)'}<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" ${creating ? 'required' : ''} /></label><label>Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" ${creating ? 'required' : ''} /></label><label>Your current ${profile.master ? 'master-admin ' : ''}password<input name="currentPassword" type="password" autocomplete="current-password" required /></label></div>`;
}
function render() {
  shell(`<section class="admin-panel"><p class="eyebrow">Your Login</p><h2>Change your email or password</h2><p>Currently signed in as <strong>${esc(profile.email)}</strong>. Use an email address you control. This changes your website login; your email mailbox password stays separate. You will sign in again after saving.</p><form id="self-account" class="booking-form">${fields(profile.email)}<button class="btn btn-primary" type="submit">Save My Login</button><p class="form-status" role="status" aria-live="polite"></p></form></section>${profile.master ? `<section class="admin-panel"><p class="eyebrow">Department Logins</p><h2>Manage staff access</h2><p>Each department has its own login. Management accounts keep access to all departments and must be edited under Your Login.</p><div class="form-grid">${departments.map(group => `<article><h3>${esc(group.label)}</h3>${group.accounts.map(account => `<p>${esc(account.email)} · ${account.master ? 'Management account' : account.active ? 'Active staff' : 'Inactive staff'} ${account.master ? '' : `<button class="btn btn-light" type="button" data-edit="${esc(account.user_id)}" data-department="${group.department}">Edit Login</button>`}</p>`).join('') || '<p>No staff login yet.</p>'}<button class="btn btn-light" type="button" data-create="${group.department}">Create ${esc(group.label)} Login</button></article>`).join('')}</div><div id="staff-editor"></div></section>` : ''}`);
  document.querySelector('#self-account').onsubmit = event => save(event, 'save_self');
  document.querySelectorAll('[data-create]').forEach(button => button.onclick = () => editor(button.dataset.create));
  document.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => editor(button.dataset.department, button.dataset.edit));
}
function editor(department, userId = '') {
  const group = departments.find(item => item.department === department);
  const account = group.accounts.find(item => item.user_id === userId);
  const defaults = { restaurant: 'restaurant@harlahotel.com', rooms: 'booking@harlahotel.com', events: 'events@harlahotel.com' };
  const target = document.querySelector('#staff-editor');
  target.innerHTML = `<h3>${userId ? 'Edit' : 'Create'} ${esc(group.label)} Login</h3><p>${userId ? 'The new details replace this staff login. Share the password privately with the authorized staff member.' : 'This creates a separate account with access to this department only. Choose its password here; do not send passwords in chat.'}</p><form id="staff-account" class="booking-form">${fields(account?.email || defaults[department], !userId)}<button class="btn btn-primary" type="submit">${userId ? 'Save Staff Login' : 'Create Staff Login'}</button><p class="form-status" role="status" aria-live="polite"></p></form>`;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.querySelector('#staff-account').onsubmit = event => save(event, 'save_staff', { department, userId });
}
async function save(event, action, extra = {}) {
  event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button[type="submit"]'), status = form.querySelector('.form-status');
  if (button.disabled) return;
  const values = Object.fromEntries(new FormData(form));
  if (values.email.trim().toLowerCase() !== values.confirmEmail.trim().toLowerCase() || values.password !== values.confirmPassword) { status.textContent = 'Check that the email addresses and new passwords match.'; return; }
  button.disabled = true; status.textContent = 'Saving login securely…';
  try {
    const result = await request(action, { ...values, ...extra });
    form.reset();
    if (result.signOut) {
      await (await getSupabaseClient()).auth.signOut();
      shell(`<section class="admin-card"><h2>Login updated</h2>${result.warning ? `<p role="alert">${esc(result.warning)}</p>` : ''}<p>Sign in with <strong>${esc(result.email)}</strong> and your password.</p><a class="btn btn-primary" href="./${route[1]}">Go to Sign In</a></section>`);
    } else {
      departments = (await request('staff')).departments; render();
      document.querySelector('#staff-editor').innerHTML = `<p class="form-status" role="status">Saved. ${esc(result.email)} can now sign in to its department. ${esc(result.warning || '')}</p>`;
    }
  } catch (error) { status.textContent = error.message; }
  finally { if (button.isConnected) button.disabled = false; for (const key of ['password', 'confirmPassword', 'currentPassword']) { if (form.elements[key]) form.elements[key].value = ''; values[key] = ''; } }
}
async function init() {
  shell('<section class="admin-card"><p>Checking account access…</p></section>');
  try { profile = await request('profile'); if (profile.master) departments = (await request('staff')).departments; render(); }
  catch (error) { shell(`<section class="admin-card"><h2>Account settings unavailable</h2><p>${esc(error.message)}</p><a class="btn btn-primary" href="./${route[1]}">Sign In</a><button class="btn btn-light" id="retry-account">Try Again</button></section>`); document.querySelector('#retry-account').onclick = init; }
}
init();
