import { Footer, Navbar, ServiceCard } from "./components.js?v=20260818-event-request-v5";
import {
  culturalPhotoRoom,
  eventGallery,
  eventHallFallbacks,
  images,
  services,
  siteConfig,
  whatsappLinks,
} from "./data.js?v=20260818-event-request-v5";
import { initImageLightbox, LightboxImage, LightboxMarkup } from "./lightbox.js?v=20260815-event-hall-v1";
import { getEventHalls, isBackendReady } from "./supabase-api.js?v=20260815-event-hall-v1";

const app = document.querySelector("#event-hall-app");
const pageHeroImage = images.event.replace("./", "/");
let halls = eventHallFallbacks;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hallCard(hall) {
  const imagesList = Array.isArray(hall.image_paths) ? hall.image_paths : [];
  const facilities = Array.isArray(hall.facilities) ? hall.facilities : [];
  const capacity = hall.capacity
    ? `Up to ${Number(hall.capacity).toLocaleString("en-US")} attendees`
    : "Capacity confirmed for your setup";

  return `
    <article class="event-hall-card reveal">
      <div class="event-hall-card-media">
        ${LightboxImage(imagesList[0] || images.eventHall, hall.name)}
        <span>${escapeHtml(hall.hall_type)}</span>
      </div>
      <div class="event-hall-card-body">
        <div class="event-hall-card-heading">
          <div><h3>${escapeHtml(hall.name)}</h3><p>${escapeHtml(capacity)}</p></div>
          <strong>${escapeHtml(hall.price_note || "Price on request")}</strong>
        </div>
        <p>${escapeHtml(hall.description || "")}</p>
        <ul class="event-hall-facilities">
          ${facilities.map((facility) => `<li>${escapeHtml(facility)}</li>`).join("")}
        </ul>
        <div class="event-hall-card-actions">
          <a class="btn btn-primary" href="./event-booking.html?hall=${encodeURIComponent(hall.slug)}">Book This Hall</a>
          <a class="btn btn-light" href="${whatsappLinks.event}" target="_blank" rel="noopener">Ask on WhatsApp</a>
        </div>
      </div>
    </article>
  `;
}

function render() {
  app.innerHTML = `
    ${Navbar("events")}
    <main id="event-main">
      <section class="page-hero event-hall-hero" style="--page-hero-image: url('${pageHeroImage}')">
        <div class="page-hero-content reveal">
          <p class="eyebrow">Event Hall</p>
          <h1>A professional setting for every important gathering</h1>
          <p>
            Reserve Harla Hotel for conferences, government meetings, workshops, weddings,
            receptions, and cultural events with clear timing and service requirements.
          </p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="#event-halls">View Event Spaces</a>
            <a class="btn btn-light" href="./event-booking.html">Start a Reservation</a>
            <a class="btn btn-whatsapp" href="${whatsappLinks.event}" target="_blank" rel="noopener">WhatsApp Events Team</a>
          </div>
        </div>
      </section>

      <section class="section event-hall-catalogue" id="event-halls" aria-labelledby="event-halls-title">
        <div class="section-heading reveal">
          <p class="eyebrow">Harla Hotel Venues</p>
          <h2 id="event-halls-title">Choose the space that fits your event</h2>
          <p>Final capacity, seating, service requirements, and pricing are confirmed by the Harla Hotel events team.</p>
        </div>
        <div class="event-hall-card-list" data-event-hall-list>
          ${halls.map(hallCard).join("")}
        </div>
        <p class="event-catalogue-status" data-event-catalogue-status role="status" aria-live="polite"></p>
      </section>

      <section class="section events" aria-labelledby="event-services-title">
        <div class="section-heading reveal">
          <p class="eyebrow">Event Support</p>
          <h2 id="event-services-title">Planned for meetings, celebrations, and formal occasions</h2>
          <p>Tell us the schedule, attendance, seating needs, and refreshments. Our team reviews the complete request before confirmation.</p>
        </div>
        <div class="service-grid">
          ${services.map(ServiceCard).join("")}
        </div>
        <div class="event-gallery-strip reveal" aria-label="Event hall setup and catering photos">
          ${eventGallery.map((item) => `
            <figure>
              ${LightboxImage(item.image, `${item.label} at Harla Hotel`)}
              <figcaption>${item.label}</figcaption>
            </figure>
          `).join("")}
        </div>
      </section>

      <section class="section split-feature" aria-labelledby="cultural-photo-title">
        <div class="split-feature-media reveal">
          ${LightboxImage(images.culturalPhotoLunchRoom, culturalPhotoRoom.title)}
        </div>
        <div class="reveal">
          <p class="eyebrow">Cultural Event Room</p>
          <h2 id="cultural-photo-title">${culturalPhotoRoom.title}</h2>
          <p>${culturalPhotoRoom.description}</p>
          <p>It is suitable for traditional Harari-themed photos, family meals, and small private gatherings.</p>
          <ul class="feature-list">
            ${culturalPhotoRoom.features.map((feature) => `<li>${feature}</li>`).join("")}
          </ul>
          <div class="cta-row">
            <a class="btn btn-primary" href="./event-booking.html?hall=cultural-photo-lunch-room">Reserve Cultural Room</a>
            <a class="btn btn-whatsapp" href="${whatsappLinks.event}" target="_blank" rel="noopener">Ask on WhatsApp</a>
          </div>
        </div>
      </section>

      <section class="section event-corporate-cta" aria-labelledby="event-corporate-title">
        <div>
          <p class="eyebrow">Corporate and Institutional Clients</p>
          <h2 id="event-corporate-title">Send one complete reservation request</h2>
          <p>Organizations, government offices, NGOs, and private clients can submit event details and receive a professional Harla Hotel reservation reference.</p>
        </div>
        <div class="event-corporate-actions">
          <a class="btn btn-primary" href="./event-booking.html">Start Event Hall Booking</a>
          <a href="tel:${siteConfig.phone.replaceAll(" ", "")}">${siteConfig.phone}</a>
          <a href="mailto:${siteConfig.eventsEmail}">${siteConfig.eventsEmail}</a>
        </div>
      </section>
    </main>
    ${LightboxMarkup("Harla Hotel event image viewer")}
    ${Footer({ email: siteConfig.eventsEmail })}
  `;

  wirePage();
}

function wirePage() {
  const header = document.querySelector("[data-header]");
  const navToggle = document.querySelector("[data-nav-toggle]");
  const navMenu = document.querySelector("[data-nav-menu]");

  const setHeaderState = () => header?.classList.toggle("is-scrolled", window.scrollY > 20);
  navToggle?.addEventListener("click", () => {
    const expanded = navToggle.getAttribute("aria-expanded") === "true";
    navToggle.setAttribute("aria-expanded", String(!expanded));
    navMenu?.classList.toggle("is-open");
  });
  window.addEventListener("scroll", setHeaderState, { passive: true });

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));
  initImageLightbox();
  setHeaderState();
}

async function loadHalls() {
  if (!isBackendReady()) {
    render();
    return;
  }

  try {
    const databaseHalls = await getEventHalls();
    if (databaseHalls.length) {
      halls = databaseHalls;
    }
  } catch (error) {
    console.warn("Event hall catalogue could not load from Supabase", error);
  }
  render();
}

loadHalls();
