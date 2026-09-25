import { Navbar, Footer } from './components.js';
import { siteConfig } from './data.js';
import { restaurantRequest } from './restaurant-api.js';
import { escapeHtml as esc, wireRestaurantNav } from './restaurant-admin-ui.js';
import { requestNumberLabel } from './request-number.js';

const images = [
  { src: './assets/restaurant/vip/majlis-03-enhanced.webp', title: 'A space to make your own.', alt: 'Wide view of the private majlis with red seating, patterned carpets and dining area' },
  { src: './assets/restaurant/vip/majlis-01-enhanced.webp', title: 'Gather a little closer.', alt: 'Traditional red and gold majlis seating around a carpeted gathering area' },
  { src: './assets/restaurant/vip/majlis-02-enhanced.webp', title: 'Make time for good company.', alt: 'Sunlit VIP room with red velvet seating and gold cushions' },
];
const phone = '+251984977677';
const state = { room: null, checking: false, submitted: false, busy: false, id: crypto.randomUUID(), slide: 0, paused: matchMedia('(prefers-reduced-motion: reduce)').matches };
document.querySelector('#vip-app').innerHTML = `${Navbar('restaurant')}<main id="vip-main"><section class="vip-gallery" aria-label="VIP majlis photo gallery" aria-roledescription="carousel" tabindex="0"><div class="vip-slides">${images.map((image, i) => `<figure class="vip-slide ${i === 0 ? 'is-active' : ''}" aria-hidden="${i !== 0}"><img src="${image.src}" alt="${image.alt}" width="1280" height="567" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} /></figure>`).join('')}</div><div class="vip-shade"></div><div class="vip-gallery-copy"><a class="vip-back" href="./restaurant.html">← Harla Restaurant</a><p class="eyebrow">Private dining · Harla Hotel</p><h1>Your own<br><em>Harla moment.</em></h1><p>Step inside our VIP majlis.</p><a href="#vip-request" class="btn btn-primary" data-vip-cta>Request a VIP Room</a></div><div class="vip-gallery-bottom"><span id="vip-caption">${images[0].title}</span><div class="vip-gallery-controls"><button type="button" data-prev aria-label="Previous photo">←</button><span id="vip-slide-count" aria-live="off">01 / 03</span><button type="button" data-next aria-label="Next photo">→</button><button type="button" data-pause aria-label="Pause slideshow">Pause</button></div></div><p class="sr-only" id="vip-gallery-announcement" aria-live="polite"></p></section><div class="vip-thumbnails" aria-label="Choose a room photo">${images.map((image, i) => `<button type="button" data-slide="${i}" aria-label="Show photo ${i + 1}: ${image.alt}" aria-current="${i === 0}"><img src="${image.src}" alt="" width="180" height="80" /><span>0${i + 1}</span></button>`).join('')}</div><section class="vip-introduction section"><div><p class="eyebrow">The VIP Majlis</p><h2>Good food.<br>Your favourite people.<br><em>A little more privacy.</em></h2></div><div><p>A private setting for a family meal, a conversation with friends, or time together over coffee. Settle into Harla’s traditional red-and-gold majlis and let our restaurant team help plan your visit.</p><div class="vip-features"><span>Private setting</span><span>Traditional majlis seating</span><span>Personal arrangements by phone</span></div><a class="text-link" href="./restaurant-order.html?order=dine_in">Explore the restaurant menu →</a></div></section><section class="section vip-request-section" id="vip-request"><div class="vip-request-copy"><p class="eyebrow">Plan your visit</p><h2>Request your<br>VIP room.</h2><p>Leave your name and phone number. Our restaurant team will call to discuss your visit and confirm the arrangements.</p><p class="vip-request-note">A request is not a confirmed reservation. Guest count and your preferred date and time are optional.</p><a class="vip-phone" href="tel:${phone}">${phone}</a><p>Restaurant enquiries · Call us directly</p></div><div class="vip-request-card"><div id="vip-availability" role="status" aria-live="polite">Checking room availability…</div><div id="vip-call-only" hidden><p>The VIP room is currently occupied. Please call the restaurant to discuss availability.</p><a class="btn btn-primary" href="tel:${phone}">Call Restaurant</a></div><form id="vip-request-form" class="booking-form" hidden><div class="form-grid"><label>Your name <span>(required)</span><input name="fullName" autocomplete="name" maxlength="160" required /></label><label>Phone number <span>(required)</span><input name="phone" type="tel" autocomplete="tel" maxlength="40" required /></label><label>Number of people <span>(optional)</span><input name="guests" type="number" min="1" max="999" inputmode="numeric" /></label><label>Preferred date <span>(optional)</span><input name="date" type="date" /></label><label>Preferred time <span>(optional · Ethiopia time)</span><input name="time" type="time" /></label></div><button type="submit" class="btn btn-primary">Send VIP Room Request</button></form><div id="vip-receipt" hidden></div><p id="vip-status" class="form-status" role="status" aria-live="polite"></p><button class="btn btn-light" type="button" id="vip-retry" hidden>Check Availability Again</button></div></section></main>${Footer({ email: siteConfig.restaurantEmail, phone: siteConfig.restaurantPhone, whatsapp: siteConfig.restaurantWhatsapp })}`;
wireRestaurantNav();
const gallery = document.querySelector('.vip-gallery');
function showSlide(index, manual = false) {
  state.slide = (index + images.length) % images.length;
  document.querySelectorAll('.vip-slide').forEach((slide, i) => { slide.classList.toggle('is-active', i === state.slide); slide.setAttribute('aria-hidden', String(i !== state.slide)); });
  document.querySelectorAll('[data-slide]').forEach((button, i) => button.setAttribute('aria-current', String(i === state.slide)));
  document.querySelector('#vip-caption').textContent = images[state.slide].title;
  document.querySelector('#vip-slide-count').textContent = `0${state.slide + 1} / 03`;
  if (manual) document.querySelector('#vip-gallery-announcement').textContent = `Photo ${state.slide + 1} of 3: ${images[state.slide].alt}`;
}
function pause(value) { state.paused = value; const button = document.querySelector('[data-pause]'); button.textContent = value ? 'Play' : 'Pause'; button.setAttribute('aria-label', value ? 'Play slideshow' : 'Pause slideshow'); }
document.querySelector('[data-prev]').onclick = () => { pause(true); showSlide(state.slide - 1, true); };
document.querySelector('[data-next]').onclick = () => { pause(true); showSlide(state.slide + 1, true); };
document.querySelector('[data-pause]').onclick = () => pause(!state.paused);
document.querySelectorAll('[data-slide]').forEach(button => button.onclick = () => { pause(true); showSlide(Number(button.dataset.slide), true); });
gallery.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); pause(true); showSlide(state.slide + (event.key === 'ArrowLeft' ? -1 : 1), true); } });
let pointerX = null;
gallery.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') pointerX = event.clientX; });
gallery.addEventListener('pointerup', event => { if (pointerX !== null && Math.abs(event.clientX - pointerX) > 55) { pause(true); showSlide(state.slide + (event.clientX < pointerX ? 1 : -1), true); } pointerX = null; });
pause(state.paused);
setInterval(() => { if (!state.paused && !document.hidden && !gallery.matches(':hover') && !gallery.contains(document.activeElement)) showSlide(state.slide + 1); }, 6500);

function renderAvailability(error = false) {
  const available = state.room?.status === 'available';
  const target = document.querySelector('#vip-availability');
  target.className = `vip-availability ${available ? 'is-available' : 'is-unavailable'}`;
  target.textContent = error ? 'Availability could not be checked. Please call the restaurant.' : available ? 'Available for requests' : 'Currently occupied · Please call';
  document.querySelector('#vip-call-only').hidden = available || state.submitted;
  document.querySelector('#vip-call-only p').textContent = error ? 'Our team can help you by phone while online availability is unavailable.' : 'The VIP room is currently occupied. Online requests reopen when the restaurant releases the room.';
  document.querySelector('#vip-request-form').hidden = !available || state.submitted;
  document.querySelector('#vip-request-form button').disabled = !available || state.busy;
  document.querySelector('#vip-retry').hidden = !error;
  const cta = document.querySelector('[data-vip-cta]'); cta.href = available ? '#vip-request' : `tel:${phone}`; cta.textContent = available ? 'Request a VIP Room' : 'Call About the VIP Room';
}
async function checkAvailability() {
  if (state.checking) return; state.checking = true;
  try { state.room = (await restaurantRequest('vip_availability')).room; renderAvailability(); }
  catch (error) { console.warn('VIP availability check failed:', error.message); state.room = null; renderAvailability(true); }
  finally { state.checking = false; }
}
document.querySelector('#vip-retry').onclick = checkAvailability;
document.querySelector('#vip-request-form').onsubmit = async event => {
  event.preventDefault(); if (state.busy || state.room?.status !== 'available') return;
  const form = event.currentTarget, status = document.querySelector('#vip-status'); state.busy = true; form.querySelector('button').disabled = true; status.textContent = 'Sending your request…';
  try {
    const result = await restaurantRequest('vip_create', { request: { ...Object.fromEntries(new FormData(form)), id: state.id } });
    state.submitted = true; form.reset(); status.textContent = '';
    const receipt = document.querySelector('#vip-receipt'); receipt.hidden = false;
    receipt.innerHTML = `<p class="eyebrow">Request received</p><h3>We’ll be in touch.</h3><p>The restaurant team will call you to confirm your arrangements.</p><p><strong>${esc(requestNumberLabel(result.request))}</strong><br>${esc(result.request.reference)}</p><a class="btn btn-light" href="tel:${phone}">Call Restaurant</a>`;
  } catch (error) { status.textContent = error.message; await checkAvailability(); }
  finally { state.busy = false; renderAvailability(!state.room); }
};
document.querySelector('input[name="date"]').min = new Date(Date.now() + 10800000).toISOString().slice(0, 10);
await checkAvailability();
setInterval(() => { if (!document.hidden) checkAvailability(); }, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkAvailability(); });
