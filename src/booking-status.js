import { Footer, Navbar } from "./components.js?v=20260521-room-automation";
import {
  backendSetupMessage,
  getRoomBookingStatus,
  isBackendReady,
} from "./supabase-api.js?v=20260728-secure-status-v2";

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

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-ET", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function humanizeStatus(value) {
  const text = String(value || "pending").replaceAll("_", " ").trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "Pending";
}

function resultState(booking) {
  const bookingStatus = String(booking.status || "pending").toLowerCase();
  const paymentStatus = String(booking.payment_status || "").toLowerCase();

  if (bookingStatus === "cancelled" || paymentStatus === "cancelled") {
    return {
      badge: "Booking Cancelled",
      title: "Booking Cancelled",
      message: "This booking is no longer active. Please contact Harla Hotel if you would like help arranging another stay.",
      tone: "cancelled",
    };
  }

  if (bookingStatus === "declined" || bookingStatus === "rejected") {
    return {
      badge: "Booking Declined",
      title: "Booking Declined",
      message: "Harla Hotel was unable to approve this booking request. Review the information below or contact our reservations team.",
      tone: "declined",
    };
  }

  if (bookingStatus === "confirmed" || bookingStatus === "approved") {
    return {
      badge: "Booking Approved",
      title: "Booking Approved",
      message: "Your stay has been approved by Harla Hotel. We look forward to welcoming you.",
      tone: "approved",
    };
  }

  if (
    [
      "pending_payment_confirmation",
      "pending_payment_review",
      "pending_verification",
      "submitted_for_verification",
    ].includes(paymentStatus)
  ) {
    return {
      badge: "Payment Review",
      title: "Payment Proof Awaiting Verification",
      message: "Your booking request and payment proof were received. Harla Hotel is reviewing the payment before confirming your stay.",
      tone: "payment",
    };
  }

  return {
    badge: "Under Review",
    title: "Booking Under Review",
    message: "Your booking request has been received and is currently being reviewed by Harla Hotel.",
    tone: "review",
  };
}

function renderMessageState({ badge, title, message, tone, allowRetry = true }) {
  return `
    <section class="booking-status-result-card status-state-${tone}">
      <span class="booking-status-badge">${escapeHtml(badge)}</span>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      ${
        allowRetry
          ? `<button class="btn btn-outline status-check-again" type="button" data-check-again>Check Again</button>`
          : ""
      }
    </section>
  `;
}

function renderResult(booking) {
  const state = resultState(booking);
  const approved = state.tone === "approved";

  return `
    <section class="booking-status-result-card status-state-${state.tone}">
      <div class="booking-status-result-heading">
        <span class="booking-status-badge">${escapeHtml(state.badge)}</span>
        <h2>${escapeHtml(state.title)}</h2>
        <p>${escapeHtml(state.message)}</p>
      </div>
      <dl class="booking-status-details">
        <div><dt>Booking reference</dt><dd>${escapeHtml(booking.booking_number)}</dd></div>
        <div><dt>Customer name</dt><dd>${escapeHtml(booking.full_name)}</dd></div>
        <div><dt>Room type</dt><dd>${escapeHtml(booking.room_type)}</dd></div>
        <div><dt>Check-in</dt><dd>${formatDate(booking.check_in)}</dd></div>
        <div><dt>Check-out</dt><dd>${formatDate(booking.check_out)}</dd></div>
        <div><dt>Guests</dt><dd>${escapeHtml(booking.guests)}</dd></div>
        <div><dt>Payment status</dt><dd>${escapeHtml(humanizeStatus(booking.payment_status))}</dd></div>
        <div><dt>Booking status</dt><dd>${escapeHtml(humanizeStatus(booking.status))}</dd></div>
        ${
          state.tone === "declined" && booking.decline_reason
            ? `<div><dt>Decline reason</dt><dd>${escapeHtml(booking.decline_reason)}</dd></div>`
            : ""
        }
        ${
          approved && booking.confirmed_at
            ? `<div><dt>Confirmation date</dt><dd>${formatDateTime(booking.confirmed_at)}</dd></div>`
            : ""
        }
      </dl>
      <div class="booking-status-result-actions">
        <button class="btn btn-outline status-check-again" type="button" data-check-again>Check Again</button>
        ${
          approved
            ? `<button class="btn btn-primary" type="button" data-download-booking-pdf>Download Confirmation PDF</button>`
            : ""
        }
      </div>
    </section>
  `;
}

app.innerHTML = `
  ${Navbar("rooms")}
  <main class="booking-status-shell" id="booking-status-main">
    <section class="booking-status-intro" aria-labelledby="booking-status-title">
      <p class="booking-status-kicker">BOOKING LOOKUP</p>
      <h1 id="booking-status-title">Check Booking Status</h1>
      <p>Enter the same full name used during booking and your Harla Hotel booking reference to view your current status securely.</p>
    </section>

    <section class="booking-status-card" aria-label="Room booking status lookup">
      <form class="booking-status-form" id="booking-status-form">
        <div class="form-grid">
          <label>
            Full Name
            <input
              name="fullName"
              type="text"
              autocomplete="name"
              placeholder="John Doe Smith"
              minlength="2"
              maxlength="200"
              required
            />
          </label>
          <label>
            Booking Reference
            <input
              name="bookingNumber"
              type="text"
              value="${escapeHtml(initialBookingNumber)}"
              placeholder="HRB-XXXXXX"
              minlength="6"
              maxlength="80"
              autocapitalize="characters"
              required
            />
          </label>
        </div>
        <button class="btn btn-primary booking-status-submit" type="submit">Check Booking Status</button>
        <p class="form-status" role="status" aria-live="polite"></p>
      </form>
      <div id="booking-status-result" aria-live="polite"></div>
    </section>
    <p class="booking-status-help">
      Need help? Contact Harla Hotel at
      <a href="tel:+251915321188">+251 915 321 188</a>.
    </p>
  </main>
  ${Footer()}
`;

const header = document.querySelector("[data-header]");
const navToggle = document.querySelector("[data-nav-toggle]");
const navMenu = document.querySelector("[data-nav-menu]");
const form = document.querySelector("#booking-status-form");
const result = document.querySelector("#booking-status-result");
const submitButton = form.querySelector(".booking-status-submit");
const defaultSubmitText = submitButton.textContent;
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
  const formData = new FormData(form);
  const fullName = formData.get("fullName");
  const bookingNumber = formData.get("bookingNumber");

  if (!fullName?.trim() || !bookingNumber?.trim()) {
    status.textContent = "Please enter your full name and booking reference.";
    return;
  }

  if (!isBackendReady()) {
    const message = backendSetupMessage();
    status.textContent = message;
    result.innerHTML = renderMessageState({
      badge: "Unavailable",
      title: "Generic Error",
      message,
      tone: "error",
    });
    return;
  }

  try {
    form.setAttribute("aria-busy", "true");
    submitButton.disabled = true;
    submitButton.textContent = "Checking...";
    status.textContent = "Securely checking your booking...";
    result.innerHTML = renderMessageState({
      badge: "Loading",
      title: "Checking Booking Status",
      message: "Please wait while we securely match your name and booking reference.",
      tone: "loading",
      allowRetry: false,
    });

    currentBooking = await getRoomBookingStatus(bookingNumber, fullName);

    if (!currentBooking) {
      result.innerHTML = renderMessageState({
        badge: "Not Found",
        title: "Booking Not Found",
        message: "We could not find a booking matching those details. Check both entries and try again.",
        tone: "not-found",
      });
      status.textContent = "No matching booking found.";
      return;
    }

    result.innerHTML = renderResult(currentBooking);
    status.textContent = "Booking status loaded securely.";
  } catch (error) {
    console.error("Room booking status lookup failed.", error);
    result.innerHTML = renderMessageState({
      badge: "Unable to Check",
      title: "Generic Error",
      message: "We could not check your booking right now. Please try again shortly or contact Harla Hotel.",
      tone: "error",
    });
    status.textContent = "Could not check this booking right now.";
  } finally {
    form.removeAttribute("aria-busy");
    submitButton.disabled = false;
    submitButton.textContent = defaultSubmitText;
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
  if (event.target.closest("[data-check-again]")) {
    currentBooking = null;
    result.innerHTML = "";
    form.querySelector(".form-status").textContent = "";
    form.reset();
    form.querySelector("[name='fullName']")?.focus();
    return;
  }

  if (!event.target.closest("[data-download-booking-pdf]") || !currentBooking) {
    return;
  }

  const { downloadBookingConfirmationPdf } = await import("./booking-confirmation-pdf.js?v=20260521-room-automation");
  await downloadBookingConfirmationPdf(currentBooking);
});

window.addEventListener("scroll", setHeaderState, { passive: true });
setHeaderState();

if (initialBookingNumber) {
  form.querySelector("[name='fullName']")?.focus();
}
