import { Footer, Navbar, ServiceCard } from "./components.js?v=20260519-client-feedback";
import { culturalPhotoRoom, eventGallery, images, services, siteConfig, whatsappLinks } from "./data.js?v=20260519-client-feedback";
import { initImageLightbox, LightboxImage, LightboxMarkup } from "./lightbox.js?v=20260519-client-feedback";
import {
  backendSetupMessage,
  createEventRequest,
  isBackendReady,
} from "./supabase-api.js?v=20260507-supabase";

const app = document.querySelector("#event-hall-app");
const pageHeroImage = images.event.replace("./", "/");

app.innerHTML = `
  ${Navbar("events")}
  <main id="event-main">
    <section class="page-hero" style="--page-hero-image: url('${pageHeroImage}')">
      <div class="page-hero-content reveal">
        <p class="eyebrow">Event Hall</p>
        <h1>Celebrate, meet, and gather at Harla Hotel</h1>
        <p>
          Book weddings, conferences, birthdays, corporate events, and cultural photo sessions with flexible
          catering choices and warm Harari hospitality.
        </p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#event-booking" data-event-service="Event hall booking">Book Event Hall</a>
          <a class="btn btn-light" href="#event-booking" data-event-service="Cultural Photo & Lunch Room booking">Book Cultural Room</a>
          <a class="btn btn-whatsapp" href="${whatsappLinks.event}">WhatsApp Event</a>
        </div>
      </div>
    </section>

    <section class="section events" aria-labelledby="event-services-title">
      <div class="section-heading reveal">
        <p class="eyebrow">Events</p>
        <h2 id="event-services-title">A polished venue for weddings, conferences, and celebrations</h2>
        <p>Choose the setup, guest count, timing, and catering package that fits your event.</p>
      </div>
      <div class="service-grid">
        ${services.map(ServiceCard).join("")}
      </div>
      <div class="event-gallery-strip reveal" aria-label="Event hall setup and catering photos">
        ${eventGallery
          .map(
            (item) => `
              <figure>
                ${LightboxImage(item.image, `${item.label} at Harla Hotel`)}
                <figcaption>${item.label}</figcaption>
              </figure>
            `,
          )
          .join("")}
      </div>
      <div class="feature-strip reveal">
        <span>Flexible seating</span>
        <span>Buffet options</span>
        <span>Refreshments</span>
        <span>Photography support</span>
        <a class="btn btn-light" href="${whatsappLinks.event}">Plan Event on WhatsApp</a>
      </div>
    </section>

    <section class="section split-feature" aria-labelledby="cultural-photo-title">
      <div class="split-feature-media reveal">
        <!-- REPLACE: Replace with final Cultural Photo & Lunch Room images when available. -->
        ${LightboxImage(images.culturalPhotoLunchRoom, culturalPhotoRoom.title)}
      </div>
      <div class="reveal">
        <p class="eyebrow">Cultural Room</p>
        <h2 id="cultural-photo-title">${culturalPhotoRoom.title}</h2>
        <p>${culturalPhotoRoom.description}</p>
        <p>
          It is spacious and suitable for traditional Harari-themed photos and meals, especially for wedding
          guests, families, and small private gatherings.
        </p>
        <ul class="feature-list">
          ${culturalPhotoRoom.features.map((feature) => `<li>${feature}</li>`).join("")}
        </ul>
        <div class="cta-row">
          <a class="btn btn-primary" href="#event-booking" data-event-service="Cultural Photo & Lunch Room booking">Book Cultural Room</a>
          <a class="btn btn-whatsapp" href="${whatsappLinks.event}">WhatsApp Cultural Room</a>
        </div>
      </div>
    </section>

    <section class="section contact" id="event-booking" aria-labelledby="event-booking-title">
      <div class="contact-copy reveal">
        <p class="eyebrow">Booking Form</p>
        <h2 id="event-booking-title">Choose date, time, guests, and catering</h2>
        <p>
          This detailed event form supports event hall booking and Cultural Photo & Lunch Room booking.
          Prices can be added once your final buffet and refreshment packages are confirmed.
        </p>
        <div class="contact-list">
          <a href="${whatsappLinks.event}">WhatsApp Plan Event</a>
          <a href="tel:${siteConfig.phone.replaceAll(" ", "")}">${siteConfig.phone}</a>
          <a href="mailto:${siteConfig.email}">${siteConfig.email}</a>
        </div>
      </div>

      <form class="booking-form reveal" id="event-form">
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
            Booking type
            <select name="serviceType" id="event-service" required>
              <option>Event hall booking</option>
              <option>Cultural Photo & Lunch Room booking</option>
            </select>
          </label>
          <label>
            Event type
            <select name="eventType" required>
              <option value="">Select event type</option>
              <option>Wedding</option>
              <option>Conference</option>
              <option>Birthday</option>
              <option>Corporate event</option>
              <option>Cultural photo session</option>
              <option>Lunch gathering</option>
              <option>Other event</option>
            </select>
          </label>
          <label>
            Event date
            <input name="eventDate" type="date" required />
          </label>
          <label>
            Start time
            <input name="startTime" type="time" required />
          </label>
          <label>
            End time
            <input name="endTime" type="time" />
          </label>
          <label>
            Number of guests
            <input name="guests" type="number" min="1" required />
          </label>
          <label>
            Catering package
            <select name="cateringPackage" required>
              <option value="">Select catering option</option>
              <option>Refreshments only - price on request</option>
              <option>Buffet only - price on request</option>
              <option>Buffet and refreshments - price on request</option>
              <option>Hall only, no catering - price on request</option>
            </select>
          </label>
          <label class="form-wide">
            Message
            <textarea name="message" rows="5" placeholder="Tell us about setup, timing, decoration, cultural photos, lunch, or special needs..."></textarea>
          </label>
        </div>
        <button class="btn btn-primary" type="submit">Send Event Request</button>
        <p class="form-status" role="status" aria-live="polite"></p>
      </form>
    </section>
  </main>
  ${LightboxMarkup("Harla Hotel event image viewer")}
  ${Footer()}
`;

const header = document.querySelector("[data-header]");
const navToggle = document.querySelector("[data-nav-toggle]");
const navMenu = document.querySelector("[data-nav-menu]");
const eventService = document.querySelector("#event-service");
const eventForm = document.querySelector("#event-form");

function setHeaderState() {
  header.classList.toggle("is-scrolled", window.scrollY > 20);
}

navToggle.addEventListener("click", () => {
  const expanded = navToggle.getAttribute("aria-expanded") === "true";
  navToggle.setAttribute("aria-expanded", String(!expanded));
  navMenu.classList.toggle("is-open");
});

document.querySelectorAll("[data-event-service]").forEach((button) => {
  button.addEventListener("click", () => {
    eventService.value = button.dataset.eventService;
  });
});

eventForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const eventRequest = Object.fromEntries(new FormData(eventForm).entries());
  const status = eventForm.querySelector(".form-status");

  if (!eventRequest.fullName?.trim() || !eventRequest.phone?.trim()) {
    status.textContent = "Please enter your full name and phone number.";
    return;
  }

  if (!isBackendReady()) {
    console.info("Harla Hotel event request", {
      endpoint: siteConfig.bookingEndpoint,
      eventRequest,
    });
    status.textContent = backendSetupMessage();
    return;
  }

  try {
    status.textContent = "Saving your event request...";
    await createEventRequest(eventRequest);
    status.textContent = "Thank you. Your event request was saved as pending.";
    eventForm.reset();
  } catch (error) {
    status.textContent = error.message || "Sorry, we could not save your event request. Please try WhatsApp.";
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
initImageLightbox();
setHeaderState();
