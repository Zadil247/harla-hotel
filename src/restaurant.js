import { restaurantRequest } from './restaurant-api.js';
import { Footer, Navbar } from "./components.js?v=20260521-restaurant-workflow";
import {
  images,
  menuPreview,
  restaurantPage,
  siteConfig,
  vipRoomGallery,
  whatsappLinks,
} from "./data.js?v=20260521-restaurant-workflow";

const app = document.querySelector("#restaurant-app");
const pageHeroImage = images.restaurant.replace("./", "/");

app.innerHTML = `
  ${Navbar("restaurant")}
  <main id="restaurant-main">
    <section class="page-hero" style="--page-hero-image: url('${pageHeroImage}')">
      <div class="page-hero-content reveal">
        <p class="eyebrow">Restaurant & VIP Dining</p>
        <h1>${restaurantPage.title}</h1>
        <p>${restaurantPage.description}</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="./restaurant-order.html">Restaurant Menu</a>
          <a class="btn btn-light" href="./restaurant-order.html">Start Order</a>
          <a class="btn btn-whatsapp" href="${whatsappLinks.table}">Contact on WhatsApp</a>
        </div>
      </div>
    </section>

    <section class="section split-feature" aria-labelledby="vip-room-title">
      <div class="split-feature-media reveal">
        <a class="vip-explore-link" href="./restaurant-vip.html"><img src="${images.vipMajlis}" alt="Explore the VIP majlis photo slideshow" loading="lazy" /><span>Explore the VIP Majlis ↗</span></a>
      </div>
      <div class="reveal">
        <p class="eyebrow">VIP Private Room</p>
        <h2 id="vip-room-title"><a href="./restaurant-vip.html">${restaurantPage.vipTitle}</a></h2>
        <p>${restaurantPage.vipDescription}</p>
        <ul class="feature-list">
          ${restaurantPage.features.map((feature) => `<li>${feature}</li>`).join("")}
        </ul>
        <div class="cta-row">
          <a class="btn btn-primary" href="./restaurant-vip.html#vip-request" data-vip-request-link>Request a VIP Room</a>
          <a class="btn btn-light" href="./restaurant-vip.html">View Room &amp; Gallery</a>
          <p data-vip-summary role="status">Availability is checked before requesting.</p>
        </div>
      </div>
    </section>

    <section class="section page-section-dark" aria-labelledby="restaurant-menu-title">
      <div class="section-heading reveal">
        <p class="eyebrow">Menu Preview</p>
        <h2 id="restaurant-menu-title">Warm meals, coffee, and private dining</h2>
        <p>Explore the restaurant menu and arrange a private gathering with our team.</p>
      </div>
      <div class="service-option-grid">
        ${menuPreview
          .map(
            (item) => `
              <article class="service-option-card reveal">
                <h3>${item}</h3>
                <p>Price on request</p>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>

    <section class="section contact" id="restaurant-booking" aria-labelledby="restaurant-booking-title">
      <div class="contact-copy reveal">
        <p class="eyebrow">Restaurant Menu</p>
        <h2 id="restaurant-booking-title">Order food, drinks, and delivery pastries</h2>
        <p>
          Start with dine in, take away, or delivery. Explore our private VIP majlis and request a visit separately from your food order.
        </p>
        <div class="contact-list">
          <a href="./restaurant-order.html">Open Restaurant Menu</a>
          <a href="./restaurant-vip.html">Explore &amp; Request the VIP Room</a>
          <a href="mailto:${siteConfig.restaurantEmail}">${siteConfig.restaurantEmail}</a>
          <a href="tel:${siteConfig.restaurantPhone.replaceAll(" ", "")}">${siteConfig.restaurantPhone}</a>
        </div>
      </div>
      <div class="booking-form reveal restaurant-menu-card">
        <h3>Restaurant Menu</h3>
        <p>Choose order type first, then select dishes, drinks, quantities, delivery pastries, and payment method.</p>
        <a class="btn btn-primary" href="./restaurant-order.html">Restaurant Menu</a>
      </div>
    </section>
  </main>
  ${Footer({ email: siteConfig.restaurantEmail, phone: siteConfig.restaurantPhone, whatsapp: siteConfig.restaurantWhatsapp })}
`;

const header = document.querySelector("[data-header]");
const navToggle = document.querySelector("[data-nav-toggle]");
const navMenu = document.querySelector("[data-nav-menu]");

function setHeaderState() {
  header.classList.toggle("is-scrolled", window.scrollY > 20);
}

navToggle.addEventListener("click", () => {
  const expanded = navToggle.getAttribute("aria-expanded") === "true";
  navToggle.setAttribute("aria-expanded", String(!expanded));
  navMenu.classList.toggle("is-open");
});

window.addEventListener("scroll", setHeaderState, { passive: true });

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 },
);

document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));
setHeaderState();

async function updateVipSummary() {
  const link = document.querySelector('[data-vip-request-link]'), status = document.querySelector('[data-vip-summary]');
  try {
    const { room } = await restaurantRequest('vip_availability');
    const available = room.status === 'available';
    link.href = available ? './restaurant-vip.html#vip-request' : 'tel:+251984977677';
    link.textContent = available ? 'Request a VIP Room' : 'VIP Occupied — Call Restaurant';
    status.textContent = available ? 'Available for requests · Our team confirms by phone.' : 'Online requests reopen when the room is released.';
  } catch { link.href = 'tel:+251984977677'; link.textContent = 'Call About the VIP Room'; status.textContent = 'Please call to check availability.'; }
}
updateVipSummary();
setInterval(() => { if (!document.hidden) updateVipSummary(); }, 10000);
