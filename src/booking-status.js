import { Footer, Navbar } from "./components.js?v=20260818-room-workflow-v2";
import { lookupRoomBookingStatus } from "./room-api.js?v=20260818-room-workflow-v2";
import { backendSetupMessage, isBackendReady } from "./supabase-api.js?v=20260818-room-workflow-v2";

const app = document.querySelector("#booking-status-app");
const params = new URLSearchParams(window.location.search);
const initialBookingNumber = params.get("booking") || "";
const refreshIntervalMs = 20_000;
let currentBooking = null;
let refreshTimer = null;
let lookupInProgress = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value, includeTime = false) {
  if (!value) return "-";
  const source = String(value).includes("T") ? new Date(value) : new Date(`${value}T12:00:00+03:00`);
  return new Intl.DateTimeFormat("en-ET", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" } : {}),
    timeZone: "Africa/Addis_Ababa",
  }).format(source);
}

function humanizeStatus(value) {
  const labels = {
    pending: "Pending Review",
    pending_review: "Pending Review",
    pending_payment_review: "Payment Pending Verification",
    pending_payment_confirmation: "Payment Pending Verification",
    submitted_for_verification: "Payment Pending Verification",
    approved: "Confirmed",
    confirmed: "Confirmed",
    checked_in: "Checked In",
    checked_out: "Checked Out",
    verified: "Payment Verified",
    paid: "Paid",
    declined: "Declined",
    rejected: "Declined",
    cancelled: "Cancelled",
  };
  const normalized = String(value || "pending").trim().toLowerCase();
  return labels[normalized] || normalized.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resultState(booking) {
  const bookingStatus = String(booking.status || "pending").toLowerCase();
  const paymentStatus = String(booking.payment_status || "").toLowerCase();

  if (bookingStatus === "cancelled" || paymentStatus === "cancelled") {
    return {
      badge: "Cancelled",
      title: "Booking Cancelled",
      message: "This booking is no longer active. Please contact our Reservations Team if you would like help arranging another stay.",
      tone: "cancelled",
    };
  }
  if (["declined", "rejected"].includes(bookingStatus)) {
    return {
      badge: "Not Approved",
      title: "Booking Not Approved",
      message: "Harla Hotel was unable to approve this booking request. Review the reason below or contact our Reservations Team.",
      tone: "declined",
    };
  }
  if (["confirmed", "approved", "checked_in", "checked_out"].includes(bookingStatus)) {
    return {
      badge: "Confirmed",
      title: "Booking Confirmed",
      message: "Your stay has been confirmed by Harla Hotel. We look forward to welcoming you.",
      tone: "approved",
    };
  }
  if ([
    "pending_payment_confirmation",
    "pending_payment_review",
    "pending_verification",
    "submitted_for_verification",
  ].includes(paymentStatus)) {
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
    message: "Your booking request has been received and Harla Hotel is currently reviewing it. We will update your booking status as soon as the review is complete.",
    tone: "review",
  };
}

function contactBlock() {
  return `
    <p class="booking-status-contact">
      For more information, contact our Reservations Team:<br />
      <a href="mailto:booking@harlahotel.com">booking@harlahotel.com</a><br />
      <a href="tel:+251915321188">+251 915 321 188</a>
    </p>
  `;
}

function renderMessageState({ badge, title, message, tone, allowRetry = true }) {
  return `
    <section class="booking-status-result-card status-state-${tone}">
      <span class="booking-status-badge">${escapeHtml(badge)}</span>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      ${allowRetry ? `<button class="btn btn-outline status-check-again" type="button" data-check-again>Check Again</button>` : ""}
    </section>
  `;
}

function renderResult(booking) {
  const state = resultState(booking);
  const confirmed = state.tone === "approved";
  const confirmationAction = confirmed
    ? booking.confirmation_pdf_url
      ? `<a class="btn btn-primary" href="${escapeHtml(booking.confirmation_pdf_url)}" target="_blank" rel="noopener">Download Confirmation PDF</a>`
      : `<p class="booking-status-pdf-note">Your official confirmation PDF is being prepared. Refresh your status shortly.</p>`
    : "";

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
        ${state.tone === "declined" && booking.decline_reason ? `<div><dt>Reason</dt><dd>${escapeHtml(booking.decline_reason)}</dd></div>` : ""}
        ${confirmed && booking.confirmed_at ? `<div><dt>Confirmation date</dt><dd>${formatDate(booking.confirmed_at, true)}</dd></div>` : ""}
      </dl>
      ${state.tone !== "approved" || !booking.confirmation_pdf_url ? contactBlock() : ""}
      <div class="booking-status-result-actions">
        <button class="btn btn-outline" type="button" data-refresh-status>Refresh Status</button>
        <button class="btn btn-outline status-check-again" type="button" data-check-again>Check Again</button>
        ${confirmationAction}
      </div>
      <p class="booking-status-auto-refresh" aria-live="polite">Status refreshes securely every 20 seconds while this result is open.</p>
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
          <label>Full Name<input name="fullName" type="text" autocomplete="name" placeholder="John Doe Smith" minlength="2" maxlength="160" required /></label>
          <label>Booking Reference<input name="bookingNumber" type="text" value="${escapeHtml(initialBookingNumber)}" placeholder="HRB-XXXXXX" minlength="10" maxlength="40" autocapitalize="characters" required /></label>
        </div>
        <button class="btn btn-primary booking-status-submit" type="submit">Check Booking Status</button>
        <p class="form-status" role="status" aria-live="polite"></p>
      </form>
      <div id="booking-status-result" aria-live="polite"></div>
    </section>
    <p class="booking-status-help">Need help? Contact <a href="mailto:booking@harlahotel.com">booking@harlahotel.com</a> or <a href="tel:+251915321188">+251 915 321 188</a>.</p>
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

function stopRefresh() {
  if (refreshTimer) window.clearInterval(refreshTimer);
  refreshTimer = null;
}

function startRefresh() {
  stopRefresh();
  refreshTimer = window.setInterval(() => lookupBooking({ background: true }), refreshIntervalMs);
}

async function lookupBooking({ background = false } = {}) {
  if (lookupInProgress) return;
  const status = form.querySelector(".form-status");
  const data = Object.fromEntries(new FormData(form).entries());
  if (!data.fullName?.trim() || !data.bookingNumber?.trim()) {
    status.textContent = "Please enter your full name and booking reference.";
    return;
  }
  if (!isBackendReady()) {
    const message = backendSetupMessage();
    status.textContent = message;
    result.innerHTML = renderMessageState({ badge: "Unavailable", title: "Unable to Check Status", message, tone: "error" });
    return;
  }

  try {
    lookupInProgress = true;
    form.setAttribute("aria-busy", "true");
    submitButton.disabled = true;
    if (!background) {
      submitButton.textContent = "Checking...";
      status.textContent = "Securely checking your booking...";
      result.innerHTML = renderMessageState({
        badge: "Loading",
        title: "Checking Booking Status",
        message: "Please wait while we securely match your name and booking reference.",
        tone: "loading",
        allowRetry: false,
      });
    }

    currentBooking = await lookupRoomBookingStatus(data.bookingNumber, data.fullName);
    if (!currentBooking) {
      stopRefresh();
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
    status.textContent = background ? "Status refreshed." : "Booking status loaded securely.";
    startRefresh();
  } catch (error) {
    if (!background) {
      console.error("Room booking status lookup failed.", error);
      result.innerHTML = renderMessageState({
        badge: "Unable to Check",
        title: "Unable to Check Status",
        message: "We could not check your booking right now. Please try again shortly or contact Harla Hotel.",
        tone: "error",
      });
      status.textContent = "Could not check this booking right now.";
    }
  } finally {
    lookupInProgress = false;
    form.removeAttribute("aria-busy");
    submitButton.disabled = false;
    submitButton.textContent = defaultSubmitText;
  }
}

navToggle?.addEventListener("click", () => {
  const expanded = navToggle.getAttribute("aria-expanded") === "true";
  navToggle.setAttribute("aria-expanded", String(!expanded));
  navMenu?.classList.toggle("is-open");
});
document.querySelectorAll("[data-nav-menu] a").forEach((link) => link.addEventListener("click", () => {
  navToggle?.setAttribute("aria-expanded", "false");
  navMenu?.classList.remove("is-open");
}));
form.addEventListener("submit", (event) => {
  event.preventDefault();
  lookupBooking();
});
result.addEventListener("click", (event) => {
  if (event.target.closest("[data-refresh-status]")) {
    lookupBooking();
    return;
  }
  if (event.target.closest("[data-check-again]")) {
    stopRefresh();
    currentBooking = null;
    result.innerHTML = "";
    form.querySelector(".form-status").textContent = "";
    form.reset();
    form.querySelector("[name='fullName']")?.focus();
  }
});
window.addEventListener("beforeunload", stopRefresh);
window.addEventListener("scroll", () => header?.classList.toggle("is-scrolled", window.scrollY > 20), { passive: true });
header?.classList.toggle("is-scrolled", window.scrollY > 20);
if (initialBookingNumber) form.querySelector("[name='fullName']")?.focus();
