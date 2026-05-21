import { Footer, Navbar } from "./components.js?v=20260521-room-automation";
import { images } from "./data.js?v=20260521-room-automation";
import { backendSetupMessage, getRoomBookingStatus, isBackendReady } from "./supabase-api.js?v=20260521-room-automation";

const app = document.querySelector("#booking-status-app");
const initialBookingNumber = new URLSearchParams(window.location.search).get("booking") || "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-ET", {
    dateStyle: "medium",
  }).format(new Date(`${value}`.includes("T") ? value : `${value}T00:00:00`));
}

function statusText(status) {
  if (status === "confirmed") {
    return "Confirmed";
  }
  if (status === "declined") {
    return "Declined";
  }
  return "Pending";
}

function renderResult(booking) {
  if (!booking) {
    return `
      <section class="admin-card order-status-result">
        <h2>No booking found</h2>
        <p>Please check the booking number and try again.</p>
      </section>
    `;
  }

  const confirmed = booking.status === "confirmed";

  return `
    <section class="admin-card order-status-result">
      <p class="eyebrow">Room Booking</p>
      <h2>${statusText(booking.status)}</h2>
      <p>
        ${
          confirmed
            ? "Your booking has been confirmed by Harla Hotel."
            : booking.status === "declined"
              ? "This booking request was declined. Please contact Harla Hotel for support."
              : "Your booking is pending review by Harla Hotel."
        }
      </p>
      <dl class="status-details">
        <div><dt>Booking number</dt><dd>${escapeHtml(booking.booking_number)}</dd></div>
        <div><dt>Guest</dt><dd>${escapeHtml(booking.full_name)}</dd></div>
        <div><dt>Room type</dt><dd>${escapeHtml(booking.room_type)}</dd></div>
        <div><dt>Check-in</dt><dd>${formatDate(booking.check_in)}</dd></div>
        <div><dt>Check-out</dt><dd>${formatDate(booking.check_out)}</dd></div>
        <div><dt>Guests</dt><dd>${escapeHtml(booking.guests)}</dd></div>
        <div><dt>Payment method</dt><dd>${escapeHtml(booking.payment_method || "-")}</dd></div>
        <div><dt>Payment status</dt><dd>${escapeHtml(booking.payment_status || "-")}</dd></div>
      </dl>
      ${
        confirmed
          ? `<button class="btn btn-primary" type="button" data-download-booking-pdf>Download Confirmation PDF</button>`
          : ""
      }
    </section>
  `;
}

app.innerHTML = `
  ${Navbar("rooms")}
  <main class="event-booking-shell" id="booking-status-main">
    <section class="room-booking-hero status-hero" style="--page-hero-image: url('${images.hero}')">
      <div class="room-booking-hero-copy reveal">
        <p class="eyebrow">Booking Status</p>
        <h1>Check Your Room Booking</h1>
        <p>Enter your Harla Hotel booking number to see whether your request is pending, confirmed, or declined.</p>
      </div>
    </section>

    <section class="section room-booking-workspace status-workspace">
      <form class="booking-form reveal" id="booking-status-form">
        <div class="form-grid">
          <label class="form-wide">
            Booking number
            <input name="bookingNumber" type="text" value="${escapeHtml(initialBookingNumber)}" placeholder="HRB-..." required />
          </label>
        </div>
        <button class="btn btn-primary" type="submit">Check Status</button>
        <p class="form-status" role="status" aria-live="polite"></p>
      </form>
      <div id="booking-status-result"></div>
    </section>
  </main>
  ${Footer()}
`;

const header = document.querySelector("[data-header]");
const navToggle = document.querySelector("[data-nav-toggle]");
const navMenu = document.querySelector("[data-nav-menu]");
const form = document.querySelector("#booking-status-form");
const result = document.querySelector("#booking-status-result");
let currentBooking = null;

function setHeaderState() {
  header.classList.toggle("is-scrolled", window.scrollY > 20);
}

function closeMenu() {
  navToggle.setAttribute("aria-expanded", "false");
  navMenu.classList.remove("is-open");
}

async function lookupBooking() {
  const status = form.querySelector(".form-status");
  const bookingNumber = new FormData(form).get("bookingNumber");

  if (!bookingNumber?.trim()) {
    status.textContent = "Please enter a booking number.";
    return;
  }

  if (!isBackendReady()) {
    status.textContent = backendSetupMessage();
    return;
  }

  try {
    status.textContent = "Checking booking...";
    currentBooking = await getRoomBookingStatus(bookingNumber);
    result.innerHTML = renderResult(currentBooking);
    status.textContent = currentBooking ? "Booking status loaded." : "No booking found.";
  } catch (error) {
    status.textContent = error.message || "Could not check this booking.";
  }
}

navToggle.addEventListener("click", () => {
  const expanded = navToggle.getAttribute("aria-expanded") === "true";
  navToggle.setAttribute("aria-expanded", String(!expanded));
  navMenu.classList.toggle("is-open");
});

document.querySelectorAll("[data-nav-menu] a").forEach((link) => {
  link.addEventListener("click", closeMenu);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  lookupBooking();
});

result.addEventListener("click", async (event) => {
  if (!event.target.closest("[data-download-booking-pdf]") || !currentBooking) {
    return;
  }

  const { downloadBookingConfirmationPdf } = await import("./booking-confirmation-pdf.js?v=20260521-room-automation");
  await downloadBookingConfirmationPdf(currentBooking);
});

window.addEventListener("scroll", setHeaderState, { passive: true });
setHeaderState();

if (initialBookingNumber) {
  lookupBooking();
}
