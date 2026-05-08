import { images, siteConfig } from "./data.js?v=20260507-supabase";
import {
  backendSetupMessage,
  createEventRequest,
  isBackendReady,
} from "./supabase-api.js?v=20260507-supabase";

const app = document.querySelector("#event-booking-app");

app.innerHTML = `
  <header class="site-header is-scrolled">
    <nav class="navbar" aria-label="Event booking navigation">
      <a class="brand" href="./index.html#home" aria-label="${siteConfig.brandName} home">
        <img class="brand-logo" src="${images.logo}" alt="" />
        <span>
          <strong>${siteConfig.brandName}</strong>
          <small>Event Hall Booking</small>
        </span>
      </a>
      <div class="nav-menu event-nav-menu">
        <a href="./index.html#events">Event Hall</a>
        <a href="./index.html#gallery">Gallery</a>
        <a href="./index.html#contact">Contact</a>
        <a class="nav-cta" href="./index.html">Main Site</a>
      </div>
    </nav>
  </header>

  <main class="event-booking-shell" id="event-main">
    <div class="event-booking-layout">
      <section class="event-booking-copy">
        <p class="eyebrow">Event Hall Booking</p>
        <h1>Plan your event at Harla Hotel</h1>
        <p>
          Choose the event date, time, guest count, and catering style. This form is ready to connect
          to Odoo or another booking system when pricing and availability rules are finalized.
        </p>
        <ul class="event-booking-list">
          <li>Weddings and receptions</li>
          <li>Conferences and corporate events</li>
          <li>Birthdays and family gatherings</li>
          <li>Buffet and refreshment package options</li>
        </ul>
      </section>

      <form class="event-booking-form" id="event-booking-form">
        <h2>Event hall request</h2>
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
            Event type
            <select name="eventType" required>
              <option value="">Select event type</option>
              <option>Wedding</option>
              <option>Conference</option>
              <option>Birthday</option>
              <option>Corporate event</option>
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
          <label class="form-wide">
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
            <textarea name="message" rows="5" placeholder="Tell us about setup, timing, decoration, and any special needs..."></textarea>
          </label>
        </div>
        <button class="btn btn-primary" type="submit">Send Event Hall Request</button>
        <p class="form-status" role="status" aria-live="polite"></p>
      </form>
    </div>
  </main>
`;

const form = document.querySelector("#event-booking-form");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const eventHallRequest = Object.fromEntries(new FormData(form).entries());
  const status = form.querySelector(".form-status");

  if (!eventHallRequest.fullName?.trim() || !eventHallRequest.phone?.trim()) {
    status.textContent = "Please enter your full name and phone number.";
    return;
  }

  if (!isBackendReady()) {
    console.info("Harla Hotel event hall request", {
      endpoint: siteConfig.bookingEndpoint,
      eventHallRequest,
    });
    status.textContent = backendSetupMessage();
    return;
  }

  try {
    status.textContent = "Saving your event hall request...";
    await createEventRequest({
      ...eventHallRequest,
      serviceType: "Event hall booking",
    });
    status.textContent = "Thank you. Your event hall request was saved as pending.";
    form.reset();
  } catch (error) {
    status.textContent = error.message || "Sorry, we could not save your event request. Please try WhatsApp.";
  }
});
