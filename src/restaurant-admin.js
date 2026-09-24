import { getSupabaseClient } from './supabase-client.js';
import { restaurantRequest } from './restaurant-api.js';
import { escapeHtml, matchingOrders, orderCard, orderSection, restaurantShell, sections, wireRestaurantNav } from './restaurant-admin-ui.js';

const app = document.querySelector('#restaurant-admin-app');
const state = { orders: [], settings: null, filter: 'pending', search: '', type: '', busy: false, message: '', email: '' };
const api = (action, payload = {}) => restaurantRequest(action, payload, true);
const redirectToLogin = (message = 'login-required') => window.location.replace(`./restaurant-admin-login.html?message=${encodeURIComponent(message)}`);

function records() {
  const orders = matchingOrders(state.orders, state.filter, state.search, state.type);
  return orders.length ? orders.map(orderCard).join('') : '<p class="empty-state">No orders match this section and search.</p>';
}

function render() {
  app.innerHTML = restaurantShell(`
    <section class="admin-toolbar"><div><strong>${state.orders.filter(order => order.status === 'pending').length}</strong><span>pending restaurant orders</span></div><span class="admin-user">${escapeHtml(state.email || 'Restaurant Team')}</span><a class="btn btn-light" href="./restaurant-order.html">View Menu</a><a class="btn btn-light" href="./admin-account.html?service=restaurant">Account Settings</a><button class="btn btn-light" type="button" data-refresh>Refresh</button><button class="btn btn-primary" type="button" data-signout>Sign Out</button></section>
    <p class="admin-status restaurant-admin-status" role="status" aria-live="polite">${escapeHtml(state.message)}</p>
    <section class="event-admin-summary restaurant-admin-summary" aria-label="Restaurant order counts">${sections.map(([value, label]) => `<button type="button" class="event-admin-summary-item ${state.filter === value ? 'is-active' : ''}" data-filter="${value}" aria-pressed="${state.filter === value}"><strong>${state.orders.filter(order => orderSection(order) === value).length}</strong><span>${label}</span></button>`).join('')}</section>
    <section class="admin-card restaurant-settings-card"><div class="admin-panel-heading compact-heading"><div><p class="eyebrow">Restaurant Availability</p><h2>Website ordering</h2></div><span class="status-pill ${state.settings.ordering_available ? 'status-approved' : 'status-declined'}">${state.settings.ordering_available ? 'Accepting Orders' : 'Ordering Paused'}</span></div>
      <form id="restaurant-settings" class="admin-settings-form"><label class="toggle-row"><input name="available" type="checkbox" ${state.settings.ordering_available ? 'checked' : ''} /> Accept website orders</label><label>Message when ordering is paused<input name="message" maxlength="300" value="${escapeHtml(state.settings.custom_message)}" placeholder="Please call the restaurant to place an order." /></label><button class="btn btn-primary" type="submit">Save Availability</button></form></section>
    <section class="admin-panel"><div class="admin-panel-heading restaurant-records-heading"><div><p class="eyebrow" data-section-label>${sections.find(([value]) => value === state.filter)[1]}</p><h2>Restaurant orders</h2><p>Latest 300 orders · Times shown in Ethiopia time</p></div><div class="restaurant-order-filters"><label>Search orders<input data-search type="search" value="${escapeHtml(state.search)}" placeholder="Reference, customer, or phone" /></label><label>Order type<select data-type><option value="">All order types</option>${['Dine In', 'Take Away', 'Delivery'].map(type => `<option ${state.type === type ? 'selected' : ''}>${type}</option>`).join('')}</select></label></div></div><div class="admin-order-grid restaurant-admin-records" data-records>${records()}</div></section>`);
  wireRestaurantNav();
  wire();
  setBusy(state.busy);
}

function setBusy(busy) {
  state.busy = busy;
  document.querySelector('#restaurant-admin-main')?.setAttribute('aria-busy', String(busy));
  document.querySelectorAll('#restaurant-admin-main button, #restaurant-admin-main input, #restaurant-admin-main select').forEach(element => { element.disabled = busy; });
}

async function run(work) {
  if (state.busy) return;
  setBusy(true);
  try { await work(); }
  catch (error) {
    if (error.status === 403 || error.status === 401) { redirectToLogin('admin-required'); return; }
    state.message = error.message || 'The request could not be completed. Please try again.';
    const status = document.querySelector('.restaurant-admin-status');
    if (status) status.textContent = state.message;
  } finally { setBusy(false); }
}

async function load() {
  const data = await api('dashboard');
  state.orders = data.orders || [];
  state.settings = data.settings;
  render();
}

function wireRecords() {
  document.querySelectorAll('[data-transition]').forEach(button => button.addEventListener('click', () => {
    if (state.busy) return;
    const order = state.orders.find(item => item.id === button.dataset.id);
    if (!order) return;
    const transition = button.dataset.transition;
    const question = transition === 'approve' ? (order.payment_status === 'pay_at_hotel' ? 'Approve this order for payment at the hotel?' : 'Have you verified the transfer? Approve this order?') : transition === 'decline' ? 'Decline this order?' : 'Confirm this order has been handed to the kitchen?';
    if (!window.confirm(question)) return;
    run(async () => {
      await api('transition', { id: order.id, updatedAt: order.updated_at, transition });
      state.message = transition === 'approve' ? 'Order approved.' : transition === 'decline' ? 'Order declined.' : 'Order marked as sent to the kitchen.';
      await load();
    });
  }));
  document.querySelectorAll('[data-proof]').forEach(button => button.addEventListener('click', () => run(async () => {
    const { url } = await api('proof', { id: button.dataset.proof });
    const target = [...document.querySelectorAll('[data-proof-result]')].find(element => element.dataset.proofResult === button.dataset.proof);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = 'Open payment proof (link expires in 2 minutes)';
    target?.replaceChildren(anchor);
  })));
}

function updateRecords() {
  document.querySelector('[data-records]').innerHTML = records();
  wireRecords();
}

function wire() {
  document.querySelector('[data-refresh]').addEventListener('click', () => run(async () => { state.message = 'Orders refreshed.'; await load(); }));
  document.querySelector('[data-signout]').addEventListener('click', () => run(async () => {
    const { error } = await (await getSupabaseClient()).auth.signOut();
    if (error) throw error;
    redirectToLogin('signed-out');
  }));
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(item => { item.classList.toggle('is-active', item.dataset.filter === state.filter); item.setAttribute('aria-pressed', String(item.dataset.filter === state.filter)); }); document.querySelector('[data-section-label]').textContent = sections.find(([key]) => key === state.filter)[1]; updateRecords(); }));
  document.querySelector('[data-search]').addEventListener('input', event => { state.search = event.target.value; updateRecords(); });
  document.querySelector('[data-type]').addEventListener('change', event => { state.type = event.target.value; updateRecords(); });
  document.querySelector('#restaurant-settings').addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    run(async () => { await api('settings_update', { available: values.has('available'), message: values.get('message') }); state.message = 'Restaurant availability saved.'; await load(); });
  });
  wireRecords();
}

async function init() {
  app.innerHTML = restaurantShell('<section class="admin-card"><h2>Opening Restaurant Team dashboard…</h2><p role="status">Checking your staff access.</p></section>');
  wireRestaurantNav();
  try {
    const { data, error } = await (await getSupabaseClient()).auth.getSession();
    if (error) throw error;
    if (!data.session) { redirectToLogin(); return; }
    state.email = data.session.user.email;
    await load();
  } catch (error) {
    if (error.status === 403 || error.status === 401) { redirectToLogin('admin-required'); return; }
    app.innerHTML = restaurantShell(`<section class="admin-card"><h2>Restaurant dashboard could not load</h2><p role="alert">${escapeHtml(error.message)}</p><div class="admin-actions"><button class="btn btn-primary" type="button" data-retry>Try Again</button><a class="btn btn-light" href="./restaurant-admin-login.html">Back to Sign In</a></div></section>`);
    wireRestaurantNav();
    document.querySelector('[data-retry]').addEventListener('click', init);
  }
}

init();
