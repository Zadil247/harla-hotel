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
        <!-- REPLACE: Replace this with final VIP room/mejlis photo if you want a different image. -->
        <img src="${images.vipMajlis}" alt="VIP Private Room with traditional mejlis seating" loading="lazy" />
      </div>
      <div class="reveal">
        <p class="eyebrow">VIP Private Room</p>
        <h2 id="vip-room-title">${restaurantPage.vipTitle}</h2>
        <p>${restaurantPage.vipDescription}</p>
        <ul class="feature-list">
          ${restaurantPage.features.map((feature) => `<li>${feature}</li>`).join("")}
        </ul>
        <div class="cta-row">
          <a class="btn btn-primary" href="./restaurant-order.html">Restaurant Menu</a>
          <a class="btn btn-whatsapp" href="${whatsappLinks.vipRoom}">WhatsApp VIP Room</a>
        </div>
      </div>
    </section>

    <section class="section page-section-dark" aria-labelledby="restaurant-menu-title">
      <div class="section-heading reveal">
        <p class="eyebrow">Menu Preview</p>
        <h2 id="restaurant-menu-title">Warm meals, coffee, and private dining</h2>
        <p>Use this area for final menu categories, VIP room packages, and private dining prices.</p>
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

    <section class="section vip-room-gallery" aria-labelledby="restaurant-vip-gallery-title">
      <div class="section-heading reveal">
        <p class="eyebrow">VIP Room Gallery</p>
        <h2 id="restaurant-vip-gallery-title">Private lunch and coffee ceremony rooms</h2>
        <p>Use this gallery to show customers the VIP spaces they can reserve for meals, coffee ceremony, and private time.</p>
      </div>
      <div class="gallery-grid compact-gallery">
        ${vipRoomGallery
          .map(
            (item) => `
              <figure class="gallery-item reveal">
                <img src="${item.image}" alt="${item.label}" loading="lazy" />
                <figcaption>${item.label}</figcaption>
              </figure>
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
          Start with dine in, take away, or delivery. Dine-in customers can request the VIP room from the order page.
        </p>
        <div class="contact-list">
          <a href="./restaurant-order.html">Open Restaurant Menu</a>
          <a href="${whatsappLinks.vipRoom}">WhatsApp VIP Room</a>
          <a href="tel:${siteConfig.phone.replaceAll(" ", "")}">${siteConfig.phone}</a>
        </div>
      </div>
      <div class="booking-form reveal restaurant-menu-card">
        <h3>Restaurant Menu</h3>
        <p>Choose order type first, then select dishes, drinks, quantities, delivery pastries, and payment method.</p>
        <a class="btn btn-primary" href="./restaurant-order.html">Restaurant Menu</a>
      </div>
    </section>
  </main>
  ${Footer()}
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
