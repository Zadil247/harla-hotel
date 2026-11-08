import { getSupabaseClient } from './supabase-client.js';
import { restaurantRequest } from './restaurant-api.js';
import { escapeHtml, restaurantShell, wireRestaurantNav } from './restaurant-admin-ui.js';

const app = document.querySelector('#restaurant-admin-login-app');
const messages = {
  'signed-out': 'Signed out successfully.',
  'login-required': 'Please sign in to open the Restaurant Team dashboard.',
  'admin-required': 'This account does not have Restaurant Team access. Sign in with an authorized restaurant staff account.',
};
const initialMessage = messages[new URLSearchParams(window.location.search).get('message')] || '';

function renderLogin(message = '') {
  app.innerHTML = restaurantShell(`<section class="admin-login admin-card"><div><p class="eyebrow">Protected Access</p><h2>Sign in as Restaurant Admin</h2><p>Use your authorized restaurant staff account to review orders, check payment proofs, and manage ordering availability.</p><p class="restaurant-login-note">A restaurant mailbox and a staff login are separate accounts. If you need access, contact the hotel administrator.</p></div><form id="restaurant-login" class="booking-form"><div class="form-grid"><label>Email<input name="email" type="email" autocomplete="username" required /></label><label>Password<input name="password" type="password" autocomplete="current-password" required /></label></div><button class="btn btn-primary" type="submit">Sign In</button><p class="form-status" role="status" aria-live="polite">${escapeHtml(message)}</p></form></section>`, true);
  wireRestaurantNav();
  document.querySelector('#restaurant-login').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    if (button.disabled) return;
    const status = form.querySelector('.form-status');
    const values = new FormData(form);
    button.disabled = true;
    status.textContent = 'Signing in…';
    try {
      const db = await getSupabaseClient();
      const { error } = await db.auth.signInWithPassword({ email: String(values.get('email')).trim(), password: String(values.get('password')) });
      if (error) throw error;
      await restaurantRequest('profile', {}, true);
      window.location.replace('./restaurant-admin.html');
    } catch (error) {
      status.textContent = error.status === 403 ? messages['admin-required'] : error.message || 'Could not sign in. Please try again.';
    } finally { button.disabled = false; }
  });
}

async function init() {
  renderLogin(initialMessage);
  const form = document.querySelector('#restaurant-login');
  let editing = false;
  form.addEventListener('input', () => { editing = true; }, { once: true });
  try {
    const { data } = await (await getSupabaseClient()).auth.getSession();
    if (!data.session || editing) return;
    await restaurantRequest('profile', {}, true);
    if (!editing) window.location.replace('./restaurant-admin.html');
  } catch { /* Keep sign-in available when the existing session lacks restaurant access. */ }
}

init();
