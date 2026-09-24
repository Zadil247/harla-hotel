import { Footer, Navbar } from './components.js?v=20260916-restaurant';
import { images, restaurantAddressAreas, restaurantPaymentMethods, siteConfig, whatsappLinks } from './data.js';
import { restaurantMenuItems } from './restaurant-menu-data.js';
import { restaurantRequest } from './restaurant-api.js';

const app=document.querySelector('#restaurant-order-app');
const labels={dine_in:'Dine In',take_away:'Take Away',delivery:'Delivery'};
const requested=new URLSearchParams(location.search).get('order');
const orderType=requested==='takeaway'?'take_away':Object.hasOwn(labels,requested)?requested:'dine_in';
const state={step:'menu',quantities:{},category:'All',search:'',settings:null,loading:true,error:'',busy:false,
  paymentChoice:orderType==='dine_in'?'cash_at_hotel':'online',orderNumber:`HRL-${crypto.randomUUID().replaceAll('-','')}`,
  details:{},proof:null};
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const money=value=>`${new Intl.NumberFormat('en-ET',{maximumFractionDigits:2}).format(value)} ETB`;
const selected=()=>restaurantMenuItems.filter(i=>state.quantities[i.id]>0).map(i=>({...i,quantity:state.quantities[i.id]}));
const total=()=>selected().reduce((sum,i)=>sum+Math.round(i.price*100)*i.quantity,0)/100;
const online=()=>orderType!=='dine_in'||state.paymentChoice==='online';
const unavailable=()=>state.loading||!state.settings?.ordering_available;
const categories=[...new Set(restaurantMenuItems.map(i=>i.category))];
function notice() {
  if(state.loading) return '<p role="status">Checking restaurant availability…</p>';
  if(!state.settings) return '<p role="alert">Restaurant availability could not be loaded. Please refresh or contact the hotel.</p>';
  if(!state.settings.ordering_available) return `<p class="order-unavailable-notice" role="status">${escape(state.settings.custom_message||'Restaurant ordering is currently unavailable.')}</p>`;
  return '';
}
function summary() {
  return `<aside class="order-summary"><p class="eyebrow">${labels[orderType]}</p><h3>Your order</h3>
    ${selected().length?`<ul>${selected().map(i=>`<li>${i.quantity} × ${escape(i.name)} <strong>${money(Math.round(i.price*100)*i.quantity/100)}</strong></li>`).join('')}</ul>`:'<p>Choose food and drinks from the menu.</p>'}
    <div class="summary-total"><span>Menu total</span><strong>${money(total())}</strong></div>
    <p>Prices include applicable taxes.${orderType==='delivery'?' Contact the hotel to confirm delivery availability and any delivery charge.':''}</p>
    ${state.step==='menu'?`<button class="btn btn-primary" type="button" data-checkout ${unavailable()?'disabled':''}>Continue to Details</button>`:''}</aside>`;
}
function card(item) {
  const quantity=state.quantities[item.id]||0;
  return `<article class="menu-item-card" data-menu-name="${escape(item.name.toLowerCase())}" data-menu-category="${escape(item.category)}">
    ${item.image?`<img class="restaurant-menu-image" src="${item.image}" alt="${escape(item.name)}" loading="lazy" width="320" height="200">`:''}
    <div><p class="card-kicker">${escape(item.category)}</p><h3>${escape(item.name)}</h3>${item.description?`<p>${escape(item.description)}</p>`:''}</div>
    <div class="menu-item-footer"><strong>${money(item.price)}</strong><div class="quantity-control" aria-label="${escape(item.name)} quantity">
    <button type="button" data-quantity="${item.id}" data-direction="-1" aria-label="Remove ${escape(item.name)}" ${quantity===0?'disabled':''}>−</button>
    <span aria-live="polite">${quantity}</span><button type="button" data-quantity="${item.id}" data-direction="1" aria-label="Add ${escape(item.name)}" ${quantity>=50?'disabled':''}>+</button></div></div></article>`;
}
function menu() {
 return `<section class="order-workspace"><div class="order-main">${notice()}
   <div class="section-heading"><p class="eyebrow">${labels[orderType]}</p><h2>Food, drinks & pastries</h2><p>Choose your favourites from Harla Restaurant.</p></div>
   <div class="restaurant-menu-filters"><label>Search menu<input type="search" id="menu-search" value="${escape(state.search)}" placeholder="Find a dish or drink"></label>
   <label>Category<select id="menu-category"><option>All</option>${categories.map(c=>`<option ${state.category===c?'selected':''}>${escape(c)}</option>`).join('')}</select></label></div>
   ${orderType==='dine_in'?`<a class="text-link" href="./restaurant-vip.html">Explore &amp; request the VIP restaurant room</a>`:''}
   <p id="menu-results" role="status"></p>
   ${categories.map((c,index)=>`<section class="menu-category" data-category="${escape(c)}" aria-labelledby="menu-category-${index}"><h3 id="menu-category-${index}">${escape(c)}</h3><div class="menu-grid">${restaurantMenuItems.filter(i=>i.category===c).map(card).join('')}</div></section>`).join('')}
   <a class="btn btn-light" href="./index.html#restaurant-order-options">Change Order Type</a>
   <p class="form-status" role="status">${escape(state.error)}</p></div>${summary()}</section>`;
}
function details() {
 const d=state.details;
 return `<section class="order-workspace"><form class="booking-form order-details-form" id="restaurant-order-form">${notice()}
   <div class="section-heading"><h2>Customer details & payment</h2><p>The restaurant will review your order before confirming it.</p></div>
   <div class="form-grid"><label>Customer name<input name="customerName" value="${escape(d.customerName)}" autocomplete="name" maxlength="160" required></label>
   <label>Phone number<input name="phone" value="${escape(d.phone)}" type="tel" autocomplete="tel" maxlength="40" required></label>
   ${orderType==='delivery'?`<label>Address area<select name="addressArea" required><option value="">Select area</option>${restaurantAddressAreas.map(a=>`<option ${d.addressArea===a?'selected':''}>${escape(a)}</option>`).join('')}</select></label><label>Delivery address / directions<input name="customAddress" value="${escape(d.customAddress)}" maxlength="500" required></label>`:''}</div>
   <div class="payment-section"><h3>Payment</h3>${orderType==='dine_in'?`<label>How would you like to pay?<select name="paymentChoice" id="payment-choice"><option value="cash_at_hotel" ${!online()?'selected':''}>Pay at the hotel</option><option value="online" ${online()?'selected':''}>Transfer payment</option></select></label>`:'<p>Transfer payment is required for take-away and delivery orders.</p>'}
   ${online()?`<label>Payment method<select name="paymentMethod" id="payment-method">${restaurantPaymentMethods.map(m=>`<option value="${m.label}" ${d.paymentMethod===m.label?'selected':''}>${m.label}</option>`).join('')}</select></label>
   <p class="payment-instructions" id="payment-instructions">${escape((restaurantPaymentMethods.find(m=>m.label===d.paymentMethod)||restaurantPaymentMethods[0]).instructions)}</p>
   <label>Transaction reference<input name="paymentReference" value="${escape(d.paymentReference)}" maxlength="160"></label>
   <label>Payment screenshot<input name="paymentScreenshot" type="file" accept="image/jpeg,image/png,image/webp" ${state.proof?'':'required'}></label>
   <p>${state.proof?`Selected: ${escape(state.proof.name)}. Choose another image to replace it.`:'JPEG, PNG or WebP, up to 3 MB.'}</p>`:''}</div>
   <div class="order-actions"><button class="btn btn-light" type="button" data-back>Back to Menu</button><button class="btn btn-primary" type="submit" ${unavailable()||state.busy?'disabled':''}>${state.busy?'Submitting…':'Submit Order'}</button></div>
   <p class="form-status" role="status">${escape(state.error)}</p></form>${summary()}</section>`;
}
function success() {
 return `<section class="order-panel success-card"><p class="eyebrow">Order received</p><h2>Thank you for ordering with Harla.</h2><p>Your order is pending restaurant review${online()?' and payment verification':''}.</p><div class="order-number-card"><span>Order reference</span><strong>${state.orderNumber}</strong></div><div class="order-actions"><a class="btn btn-primary" href="./order-status.html?order=${state.orderNumber}">Check Order Status</a><a class="btn btn-light" href="./restaurant-order.html">Start Another Order</a></div></section>`;
}
function filterMenu() {
 let count=0;
 document.querySelectorAll('[data-menu-name]').forEach(card=>{
  card.hidden=!(state.category==='All'||card.dataset.menuCategory===state.category)||!card.dataset.menuName.includes(state.search.trim().toLowerCase());
  if(!card.hidden) count++;
 });
 document.querySelectorAll('[data-category]').forEach(section=>{section.hidden=![...section.querySelectorAll('[data-menu-name]')].some(card=>!card.hidden);});
 const results=document.querySelector('#menu-results');if(results) results.textContent=count?`${count} menu ${count===1?'item':'items'}`:'No matching items. Try another search or category.';
}
function captureDetails() {
 const form=document.querySelector('#restaurant-order-form');if(!form)return;
 const values=Object.fromEntries(new FormData(form));delete values.paymentScreenshot;state.details=values;
}
function render() {
 app.innerHTML=`${Navbar('restaurant')}<main class="restaurant-order-shell" id="restaurant-order-main"><section class="restaurant-order-hero compact-hero" style="--page-hero-image:url('${images.restaurant}')"><div class="page-hero-content"><p class="eyebrow">Harla Restaurant</p><h1>Restaurant Menu</h1><p>${labels[orderType]} · Fresh favourites, warm hospitality.</p></div></section><div class="order-container">${state.step==='menu'?menu():state.step==='details'?details():success()}</div></main>${Footer({ email: siteConfig.restaurantEmail, phone: siteConfig.restaurantPhone, whatsapp: siteConfig.restaurantWhatsapp })}`;
 document.querySelector('[data-header]')?.classList.add('is-scrolled');
 document.querySelector('[data-nav-toggle]')?.addEventListener('click',event=>{const b=event.currentTarget;b.setAttribute('aria-expanded',String(b.getAttribute('aria-expanded')!=='true'));document.querySelector('[data-nav-menu]').classList.toggle('is-open');});
 document.querySelector('#menu-search')?.addEventListener('input',e=>{state.search=e.target.value;filterMenu();});
 document.querySelector('#menu-category')?.addEventListener('change',e=>{state.category=e.target.value;filterMenu();});
 document.querySelectorAll('[data-quantity]').forEach(button=>button.addEventListener('click',()=>{const {quantity:id,direction}=button.dataset;state.quantities[id]=Math.max(0,Math.min(50,(state.quantities[id]||0)+Number(direction)));render();document.querySelector(`[data-quantity="${id}"][data-direction="${direction}"]`)?.focus({preventScroll:true});}));
 document.querySelector('[data-checkout]')?.addEventListener('click',()=>{if(!selected().length){state.error='Choose at least one menu item.';render();return;}state.error='';state.step='details';render();document.querySelector('#restaurant-order-main').scrollIntoView();});
 document.querySelector('[data-back]')?.addEventListener('click',()=>{captureDetails();state.step='menu';state.error='';render();});
 document.querySelector('#payment-choice')?.addEventListener('change',e=>{captureDetails();state.paymentChoice=e.target.value;render();});
 document.querySelector('#payment-method')?.addEventListener('change',e=>{state.details.paymentMethod=e.target.value;document.querySelector('#payment-instructions').textContent=restaurantPaymentMethods.find(m=>m.label===e.target.value)?.instructions||'';});
 document.querySelector('[name="paymentScreenshot"]')?.addEventListener('change',e=>{state.proof=e.target.files[0]||state.proof;});
 document.querySelector('#restaurant-order-form')?.addEventListener('submit',submit);
 if(state.step==='menu') filterMenu();
}
async function fileData(file) {
 if(!file||file.size>3*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type)) throw Error('Upload a JPEG, PNG or WebP payment screenshot up to 3 MB.');
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('The payment screenshot could not be read.'));reader.onload=()=>resolve({data:String(reader.result).split(',')[1]});reader.readAsDataURL(file);});
}
async function submit(event) {
 event.preventDefault();if(state.busy)return;captureDetails();state.busy=true;state.error='';render();
 try {
  const order={...state.details,orderNumber:state.orderNumber,orderType:labels[orderType],items:selected().map(i=>({id:i.id,quantity:i.quantity})),paymentMethod:online()?(state.details.paymentMethod||restaurantPaymentMethods[0].label):'cash_at_hotel',paymentScreenshot:online()?await fileData(state.proof):null};
  const saved=await restaurantRequest('create',{order});state.orderNumber=saved.order.order_number;state.step='success';
 }catch(error){state.error=error.message;}finally{state.busy=false;render();}
}
render();
try {state.settings=(await restaurantRequest('settings')).settings;}catch{}finally{state.loading=false;render();}
