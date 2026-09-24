import { escapeHtml as esc } from './restaurant-admin-ui.js';
import { requestNumberLabel } from './request-number.js';

export function vipAdminPanel(data) {
  if (!data) return '<section class="admin-panel"><h2>VIP Majlis</h2><p>VIP requests could not be loaded.</p></section>';
  const { room, requests } = data;
  const open = requests.filter(row => ['pending', 'contacted', 'occupied'].includes(row.status));
  const closed = requests.filter(row => ['completed', 'declined'].includes(row.status));
  const active = requests.find(row => row.id === room.active_request_id);
  function card(row) {
    const button = (action, label) => `<button class="btn btn-light" type="button" data-vip-action="${action}" data-vip-id="${esc(row.id)}">${label}</button>`;
    const tel = String(row.phone).replace(/[^+\d]/g, '');
    return `<article class="admin-order-card"><div class="admin-order-card-head"><div><p class="eyebrow">${esc(requestNumberLabel(row))}</p><h3>${esc(row.full_name)}</h3></div><span class="status-pill">${esc(row.status)}</span></div><dl class="admin-order-details"><div><dt>Phone</dt><dd><a href="tel:${esc(tel)}">${esc(row.phone)}</a></dd></div><div><dt>People</dt><dd>${esc(row.guests ?? 'Discuss by phone')}</dd></div><div><dt>Preferred date</dt><dd>${esc(row.preferred_date || 'Discuss by phone')}</dd></div><div><dt>Preferred time · Ethiopia</dt><dd>${esc(row.preferred_time?.slice(0, 5) || 'Discuss by phone')}</dd></div><div><dt>Received · Ethiopia</dt><dd>${esc(new Date(row.created_at).toLocaleString('en-GB', { timeZone: 'Africa/Addis_Ababa', dateStyle: 'medium', timeStyle: 'short' }))}</dd></div></dl><p class="master-reference">${esc(row.booking_reference)}</p><div class="admin-actions"><a class="btn btn-primary" href="tel:${esc(tel)}">Call Customer</a>${row.status === 'pending' ? button('contact', 'Mark Contacted') : ''}${row.status === 'contacted' && room.status === 'available' ? button('occupy', 'Mark Room Occupied') : ''}${['pending', 'contacted'].includes(row.status) ? button('decline', 'Decline Request') : ''}</div></article>`;
  }
  return `<section class="admin-panel restaurant-vip-admin" id="restaurant-vip-admin"><div class="admin-panel-heading"><div><p class="eyebrow">VIP Private Dining</p><h2>VIP Majlis</h2><p>Call the customer first, then mark them contacted. Mark the room occupied when it is in use; release it when the guests leave.</p></div><span class="status-pill ${room.status === 'available' ? 'status-approved' : 'status-declined'}">${room.status === 'available' ? 'Available for requests' : 'Occupied · Online requests closed'}</span></div><div class="admin-actions">${room.status === 'occupied' ? `<p>${active ? `In use by ${esc(active.full_name)}.` : 'Occupied by a phone or walk-in booking.'}</p><button class="btn btn-primary" type="button" data-vip-action="release">Release VIP Room</button>` : '<button class="btn btn-light" type="button" data-vip-action="occupy">Mark Occupied — Phone / Walk-in</button>'}<a href="./restaurant-vip.html" class="btn btn-light" target="_blank" rel="noopener">View VIP Room Page</a></div><h3>${open.length} active VIP ${open.length === 1 ? 'request' : 'requests'}</h3><div class="admin-order-grid">${open.length ? open.map(card).join('') : '<p class="empty-state">No active VIP requests. New requests appear here automatically.</p>'}</div>${closed.length ? `<details><summary>Completed &amp; declined VIP requests (${closed.length})</summary><div class="admin-order-grid">${closed.map(card).join('')}</div></details>` : ''}<p class="restaurant-record-note">Latest 300 VIP requests · Refreshes every 10 seconds</p></section>`;
}

export function wireVipAdmin({ data, run, api, load, message }) {
  document.querySelectorAll('[data-vip-action]').forEach(button => button.onclick = () => {
    const transition = button.dataset.vipAction, id = button.dataset.vipId;
    const row = data.requests.find(item => item.id === id);
    const prompt = transition === 'release' ? 'Release the VIP room and reopen online requests?'
      : transition === 'occupy' ? 'Mark the VIP room occupied? Customers will only be able to call until you release it.'
        : transition === 'contact' ? 'Have you spoken to this customer about their VIP request?'
          : 'Decline this VIP request?';
    if (!window.confirm(prompt)) return;
    run(async () => {
      await api('vip_transition', { transition, id: row?.id, version: row?.version, roomVersion: data.room.version });
      message(transition === 'release' ? 'VIP room released. Online requests are open.' : transition === 'occupy' ? 'VIP room occupied. New online requests are blocked.' : 'VIP request updated.');
      await load();
    });
  });
}
