import {Navbar,Footer} from './components.js';
import {getSupabaseClient} from './supabase-client.js';
import {restaurantRequest} from './restaurant-api.js';
const app=document.querySelector('#restaurant-admin-app');
const state={orders:[],settings:null,status:'pending',busy:false,message:'',authorized:false};
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const api=(action,payload={})=>restaurantRequest(action,payload,true);
function shell(content) {
 app.innerHTML=`${Navbar('admin')}<main class="admin-shell" id="restaurant-admin-main"><section class="admin-hero"><div><p class="eyebrow">Restaurant operations</p><h1>Restaurant Admin</h1><p>Review orders, verify payments, and send approved orders to the kitchen.</p><div class="order-actions"><a href="./admin.html">Room Admin</a><a href="./event-admin.html">Events Admin</a><a href="./restaurant-order.html">View Menu</a></div></div></section>${content}</main>${Footer()}`;
 document.querySelector('[data-header]')?.classList.add('is-scrolled');
 document.querySelector('[data-nav-toggle]')?.addEventListener('click',event=>{const b=event.currentTarget;b.setAttribute('aria-expanded',String(b.getAttribute('aria-expanded')!=='true'));document.querySelector('[data-nav-menu]').classList.toggle('is-open');});
}
function login(message='') {
 state.authorized=false;
 shell(`<section class="admin-card"><h2>Restaurant staff sign-in</h2><form id="restaurant-login" class="booking-form"><div class="form-grid"><label>Email<input type="email" name="email" autocomplete="username" required></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label></div><button type="submit" class="btn btn-primary">Sign In</button><p role="status" class="form-status">${escape(message)}</p></form></section>`);
 document.querySelector('#restaurant-login').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button');button.disabled=true;
  try{const values=new FormData(form);const db=await getSupabaseClient();const result=await db.auth.signInWithPassword({email:String(values.get('email')).trim(),password:String(values.get('password'))});if(result.error)throw result.error;await load();}
  catch(error){login(error.message);}finally{button.disabled=false;}
 });
}
function rows() {
 return state.orders.filter(o=>o.status===state.status).map(o=>{
  const items=Array.isArray(o.items)?o.items:[];
  const total=items.reduce((sum,i)=>sum+(Number(i.line_total)||0),0);
  return `<tr><td><strong>${escape(o.order_number)}</strong><br>${new Date(o.created_at).toLocaleString('en-GB',{timeZone:'Africa/Addis_Ababa'})}<br>${escape(o.order_type)}</td>
  <td>${escape(o.customer_name)}<br>${escape(o.phone)}<br>${escape(o.address_area||'')} ${escape(o.custom_address||'')}</td>
  <td><ul>${items.map(i=>`<li>${escape(i.quantity)} × ${escape(i.name)} — ${escape(i.line_total)} ETB</li>`).join('')}</ul><strong>${total.toLocaleString('en-ET')} ETB</strong></td>
  <td>${escape(o.payment_method)}<br>${escape(o.payment_reference||'No transfer reference')}<br>${o.payment_status==='pay_at_hotel'?'Collect payment at hotel':'Transfer proof submitted'}
  ${o.payment_screenshot_url?`<button class="btn btn-light" data-proof="${o.id}">View payment proof</button><span id="proof-${o.id}"></span>`:''}</td>
  <td><div class="restaurant-admin-actions">${o.status==='pending'?`<button class="btn btn-primary" data-id="${o.id}" data-transition="approve">Approve</button><button class="btn btn-light" data-id="${o.id}" data-transition="decline">Decline</button>`:o.status==='approved'&&o.odoo_status!=='entered'?`<button class="btn btn-primary" data-id="${o.id}" data-transition="kitchen">Mark sent to kitchen</button>`:escape(o.status==='declined'?'Declined':'Sent to kitchen')}</div></td></tr>`;
 }).join('');
}
function render() {
 shell(`<section class="admin-card"><div class="order-actions"><button class="btn btn-light" data-refresh>Refresh</button><button class="btn btn-light" data-signout>Sign Out</button></div><p role="status" class="form-status">${escape(state.message)}</p>
 <form id="restaurant-settings" class="booking-form"><h2>Ordering availability</h2><label><input name="available" type="checkbox" ${state.settings.ordering_available?'checked':''}> Accept website orders</label><label>Message when ordering is closed<input name="message" maxlength="300" value="${escape(state.settings.custom_message)}"></label><button class="btn btn-primary" type="submit">Save availability</button></form></section>
 <section class="admin-card"><h2>Restaurant orders</h2><p>Latest 300 orders. Times are shown in Ethiopia time.</p><label>Order status<select id="order-filter">${['pending','approved','declined'].map(s=>`<option value="${s}" ${s===state.status?'selected':''}>${s[0].toUpperCase()+s.slice(1)} (${state.orders.filter(o=>o.status===s).length})</option>`).join('')}</select></label><div class="restaurant-admin-table-wrap"><table class="restaurant-admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Payment</th><th>Actions</th></tr></thead><tbody>${rows()||'<tr><td colspan="5">No orders in this category.</td></tr>'}</tbody></table></div></section>`);
 document.querySelector('[data-refresh]').addEventListener('click',()=>run(load));
 document.querySelector('[data-signout]').addEventListener('click',async()=>{await (await getSupabaseClient()).auth.signOut();login('Signed out.');});
 document.querySelector('#order-filter').addEventListener('change',event=>{state.status=event.target.value;render();});
 document.querySelector('#restaurant-settings').addEventListener('submit',event=>{event.preventDefault();const values=new FormData(event.currentTarget);run(async()=>{await api('settings_update',{available:values.has('available'),message:values.get('message')});state.message='Availability saved.';await load();});});
 document.querySelectorAll('[data-transition]').forEach(button=>button.addEventListener('click',()=>{
  const order=state.orders.find(o=>o.id===button.dataset.id),transition=button.dataset.transition;
  const prompt=transition==='approve'?(order.payment_status==='pay_at_hotel'?'Approve this order for payment at the hotel?':'Have you verified the transfer? Approve this order?'):transition==='decline'?'Decline this order?':'Confirm this order has been handed to the kitchen?';
  if(!confirm(prompt))return;
  run(async()=>{await api('transition',{id:order.id,updatedAt:order.updated_at,transition});state.message='Order updated.';await load();});
 }));
 document.querySelectorAll('[data-proof]').forEach(button=>button.addEventListener('click',()=>run(async()=>{const {url}=await api('proof',{id:button.dataset.proof});const target=document.querySelector(`#proof-${button.dataset.proof}`);const anchor=document.createElement('a');anchor.href=url;anchor.target='_blank';anchor.rel='noopener';anchor.textContent='Open screenshot (expires in 2 minutes)';target.replaceChildren(anchor);})));
}
async function run(work) {
 if(state.busy)return;state.busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);
 try{await work();}catch(error){if(error.status===403){login(error.message);return;}state.message=error.message;render();}
 finally{state.busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}
}
async function load(){const data=await api('dashboard');state.orders=data.orders;state.settings=data.settings;state.authorized=true;render();}
shell('<p role="status">Checking staff access…</p>');
try{await load();}catch(error){login(error.status===403?'':error.message);}
