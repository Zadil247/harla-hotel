import { AdminServiceNav, Navbar } from './components.js';
import { images, siteConfig } from './data.js';

export const sections = [['pending', 'Pending Review'], ['approved', 'Approved'], ['kitchen', 'Sent to Kitchen'], ['declined', 'Declined']];
export const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function orderSection(order) {
  return order.status === 'approved' && order.odoo_status === 'entered' ? 'kitchen' : order.status;
}

export function matchingOrders(orders, filter, search = '', type = '') {
  const query = search.trim().toLowerCase();
  return orders.filter(order => orderSection(order) === filter && (!type || order.order_type === type)
    && (!query || [order.order_number, order.customer_name, order.phone].some(value => String(value || '').toLowerCase().includes(query))));
}

export function restaurantShell(content, login = false) {
  return `${Navbar('restaurant')}<main class="admin-shell restaurant-admin-shell" id="restaurant-admin-main">
    <section class="admin-hero"><div><p class="eyebrow">Restaurant Team${login ? ' Access' : ''}</p><h1>Harla Hotel Restaurant</h1>
      <p>${login ? 'Sign in to manage restaurant orders, review payments, and keep the kitchen up to date.' : 'Review orders, verify payments, and manage the handoff to your kitchen.'}</p></div>
      <img src="${images.logo}" alt="${siteConfig.brandName} logo" /></section>
    ${AdminServiceNav('restaurant')}${content}
    <p class="restaurant-admin-contact">Restaurant enquiries: <a href="mailto:${siteConfig.restaurantEmail}">${siteConfig.restaurantEmail}</a></p></main>`;
}

export function wireRestaurantNav() {
  document.querySelector('[data-header]')?.classList.add('is-scrolled');
  document.querySelector('[data-nav-toggle]')?.addEventListener('click', event => {
    const button = event.currentTarget;
    button.setAttribute('aria-expanded', String(button.getAttribute('aria-expanded') !== 'true'));
    document.querySelector('[data-nav-menu]')?.classList.toggle('is-open');
  });
}

function money(value) {
  return `${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ETB`;
}

function paymentLabel(order) {
  if (order.status === 'declined') return 'Order declined';
  if (order.payment_status === 'pay_at_hotel') return 'Collect payment at hotel';
  return order.status === 'approved' ? 'Payment verified' : 'Awaiting verification';
}

export function orderCard(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const total = items.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0);
  const section = orderSection(order);
  const label = sections.find(([key]) => key === section)?.[1] || 'Unknown';
  const date = new Date(order.created_at);
  const created = Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString('en-GB', { timeZone: 'Africa/Addis_Ababa', dateStyle: 'medium', timeStyle: 'short' });
  const id = escapeHtml(order.id);
  const action = (transition, text, className = '') => `<button class="status-action ${className}" type="button" data-id="${id}" data-transition="${transition}">${text}</button>`;
  return `<article class="admin-order-card restaurant-order-record" aria-label="Order ${escapeHtml(order.order_number)}">
    <div class="admin-order-card-head"><div><p class="eyebrow restaurant-order-reference">${escapeHtml(order.order_number)}</p><h3>${escapeHtml(order.customer_name)}</h3><p class="restaurant-order-created">${escapeHtml(created)} · Ethiopia time</p></div><span class="status-pill status-${escapeHtml(order.status)}">${label}</span></div>
    <dl class="admin-order-details">
      <div><dt>Order type</dt><dd>${escapeHtml(order.order_type)}</dd></div><div><dt>Phone</dt><dd>${escapeHtml(order.phone)}</dd></div>
      ${order.order_type === 'Delivery' ? `<div class="restaurant-order-wide"><dt>Delivery address</dt><dd>${escapeHtml([order.address_area, order.custom_address].filter(Boolean).join(' · '))}</dd></div>` : ''}
      <div><dt>Payment method</dt><dd>${escapeHtml(order.payment_method === 'cash_at_hotel' ? 'Cash at hotel' : order.payment_method)}</dd></div><div><dt>Payment status</dt><dd>${paymentLabel(order)}</dd></div>
      ${order.payment_reference ? `<div class="restaurant-order-wide"><dt>Transfer reference</dt><dd>${escapeHtml(order.payment_reference)}</dd></div>` : ''}
    </dl>
    <div class="restaurant-order-items"><h4>Order items</h4><ul>${items.map(item => `<li><span>${escapeHtml(item.quantity)} × ${escapeHtml(item.name)}</span><strong>${money(item.line_total)}</strong></li>`).join('')}</ul><div class="restaurant-order-total"><span>Total</span><strong>${money(total)}</strong></div></div>
    ${order.payment_screenshot_url ? `<div class="restaurant-proof"><button class="status-action" type="button" data-proof="${id}">View payment proof</button><span data-proof-result="${id}" role="status"></span></div>` : ''}
    <div class="admin-actions">${section === 'pending' ? action('approve', 'Approve Order') + action('decline', 'Decline Order', 'status-action-warning') : ''}${section === 'approved' ? action('kitchen', 'Mark Sent to Kitchen') : ''}${section === 'kitchen' ? '<p class="restaurant-record-note">Handed to the kitchen.</p>' : ''}${section === 'declined' ? '<p class="restaurant-record-note">This order was declined and has not been sent to the kitchen.</p>' : ''}</div>
  </article>`;
}
