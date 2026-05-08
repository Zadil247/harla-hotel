import { Footer, Navbar } from "./components.js?v=20260507-supabase";
import {
  images,
  menuPreview,
  restaurantPage,
  siteConfig,
  vipRoomGallery,
  whatsappLinks,
} from "./data.js?v=20260507-supabase";
import {
  backendSetupMessage,
  createRestaurantRequest,
  isBackendReady,
} from "./supabase-api.js?v=20260507-supabase";

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
          <a class="btn btn-primary" href="#restaurant-booking" data-restaurant-service="VIP Private Room reservation">Reserve VIP Room</a>
          <a class="btn btn-light" href="#restaurant-booking" data-restaurant-service="Restaurant reservation">Reserve Table</a>
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
          <a class="btn btn-primary" href="#restaurant-booking" data-restaurant-service="VIP Private Room reservation">Reserve VIP Room</a>
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
        <p class="eyebrow">Restaurant Booking</p>
        <h2 id="restaurant-booking-title">Reserve a table or VIP room</h2>
        <p>
          Choose the reservation type, date, time, guests, and message. This form is ready to connect to Odoo
          or another restaurant booking endpoint later.
        </p>
        <div class="contact-list">
          <a href="${whatsappLinks.table}">WhatsApp Table Reservation</a>
          <a href="${whatsappLinks.vipRoom}">WhatsApp VIP Room</a>
          <a href="tel:${siteConfig.phone.replaceAll(" ", "")}">${siteConfig.phone}</a>
        </div>
      </div>
      <form class="booking-form reveal" id="restaurant-form">
        <div class="form-grid">
          <label>
            Full name
            <input name="fullName" type="text" autocomplete="name" required />
          </label>
          <label>
            Phone
            <input name="phone" type="tel" autocomplete="tel" required />
          </label>
          <label>
            Email
            <input name="email" type="email" autocomplete="email" />
          </label>
          <label>
            Reservation type
            <select name="serviceType" id="restaurant-service" required>
              <option>Restaurant reservation</option>
              <option>VIP Private Room reservation</option>
            </select>
          </label>
          <label>
            Reservation date
            <input name="reservationDate" type="date" required />
          </label>
          <label>
            Reservation time
            <input name="reservationTime" type="time" required />
          </label>
          <label>
            Number of guests
            <input name="guests" type="number" min="1" required />
          </label>
          <label class="form-wide">
            Message
            <textarea name="message" rows="5" placeholder="Tell us about your table, VIP room, food, or coffee ceremony request..."></textarea>
          </label>
        </div>
        <button class="btn btn-primary" type="submit">Send Restaurant Request</button>
        <p class="form-status" role="status" aria-live="polite"></p>
      </form>
    </section>
  </main>
  ${Footer()}
`;

const header = document.querySelector("[data-header]");
const navToggle = document.querySelector("[data-nav-toggle]");
const navMenu = document.querySelector("[data-nav-menu]");
const restaurantService = document.querySelector("#restaurant-service");
const restaurantForm = document.querySelector("#restaurant-form");

function setHeaderState() {
  header.classList.toggle("is-scrolled", window.scrollY > 20);
}

navToggle.addEventListener("click", () => {
  const expanded = navToggle.getAttribute("aria-expanded") === "true";
  navToggle.setAttribute("aria-expanded", String(!expanded));
  navMenu.classList.toggle("is-open");
});

document.querySelectorAll("[data-restaurant-service]").forEach((button) => {
  button.addEventListener("click", () => {
    restaurantService.value = button.dataset.restaurantService;
  });
});

restaurantForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const restaurantRequest = Object.fromEntries(new FormData(restaurantForm).entries());
  const status = restaurantForm.querySelector(".form-status");

  if (!restaurantRequest.fullName?.trim() || !restaurantRequest.phone?.trim()) {
    status.textContent = "Please enter your full name and phone number.";
    return;
  }

  if (!isBackendReady()) {
    console.info("Harla Hotel restaurant request", {
      endpoint: siteConfig.bookingEndpoint,
      restaurantRequest,
    });
    status.textContent = backendSetupMessage();
    return;
  }

  try {
    status.textContent = "Saving your restaurant request...";
    await createRestaurantRequest(restaurantRequest);
    status.textContent = "Thank you. Your restaurant request was saved as pending.";
    restaurantForm.reset();
  } catch (error) {
    status.textContent = error.message || "Sorry, we could not save your restaurant request. Please try WhatsApp.";
  }
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
