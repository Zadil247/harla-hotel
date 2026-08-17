import { Footer, Navbar } from "./components.js?v=20260815-event-hall-v1";
import { images, siteConfig } from "./data.js?v=20260815-event-hall-v1";
import {
  displayEventType,
  escapeHtml,
  formatEventDate,
  formatEventTime,
  normalizeEventServices,
} from "./event-booking-core.js?v=20260815-event-hall-v1";
import {
  generateEventHallOfficialConfirmation,
  getEventHallBookingById,
  isBackendReady,
  requireAdminAccess,
  sendEventHallConfirmationEmail,
  signOutAdmin,
  updateEventHallBookingStatus,
} from "./supabase-api.js?v=20260815-event-hall-v1";
import {
  downloadEventHallConfirmationPdf,
  openPrintableEventHallConfirmation,
} from "./event-confirmation-pdf.js?v=20260815-event-hall-v1";

const app = document.querySelector("#event-booking-detail-app");
const bookingId = new URLSearchParams(window.location.search).get("id") || "";
let booking = null;
let adminProfile = null;

function statusLabel(value) {
  return String(value || "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shell(content) {
  app.innerHTML = `
    ${Navbar("admin")}
    <main class="admin-shell event-detail-shell" id="event-detail-main">
      <section class="admin-hero event-detail-hero">
        <div>
          <p class="eyebrow">Event Hall Booking</p>
          <h1>${escapeHtml(booking?.booking_reference || "Booking Detail")}</h1>
          <p>Protected reservation, payment, document, and status information.</p>
        </div>
        <img src="${images.logo}" alt="${siteConfig.brandName} logo" />
      </section>
      ${content}
    </main>
    ${Footer()}
  `;
  document.querySelector("[data-header]")?.classList.add("is-scrolled");
  wireNav();
}

function wireNav() {
  const toggle = document.querySelector("[data-nav-toggle]");
  const menu = document.querySelector("[data-nav-menu]");
  toggle?.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    menu?.classList.toggle("is-open");
  });
}

function renderLoading() {
  shell(`<section class="admin-card"><h2>Loading event hall booking...</h2><p class="form-status">Checking admin access and retrieving the reservation.</p></section>`);
}

function renderError(message) {
  shell(`
    <section class="admin-card">
      <h2>Booking details could not load</h2>
      <p>${escapeHtml(message)}</p>
      <a class="btn btn-primary" href="./admin.html#event-hall-bookings">Return to Admin Dashboard</a>
    </section>
  `);
}

function serviceMarkup() {
  const services = normalizeEventServices(booking.refreshments_services);
  if (!services.length) {
    return "<p>No refreshments or additional services selected.</p>";
  }
  return `<ul class="admin-line-list">${services.map((service) => `
    <li><strong>${escapeHtml(service.name)}</strong>${service.quantity ? `: ${escapeHtml(service.quantity)} ${escapeHtml(String(service.quantityLabel || "quantity").toLowerCase())}` : ""}${service.notes ? `, ${escapeHtml(service.notes)}` : ""}</li>
  `).join("")}</ul>`;
}

function detail(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "-")}</dd></div>`;
}

function renderDetail(message = "") {
  shell(`
    <section class="admin-toolbar event-detail-toolbar">
      <a class="btn btn-light" href="./admin.html#event-hall-bookings">Back to Dashboard</a>
      <span class="admin-user">${escapeHtml(adminProfile.full_name || adminProfile.email)}</span>
      <button class="btn btn-light" type="button" data-detail-download>Download PDF</button>
      <button class="btn btn-primary" type="button" data-detail-print>Print Confirmation</button>
      <button class="btn btn-light" type="button" data-detail-signout>Sign Out</button>
    </section>

    ${message ? `<section class="admin-card admin-notice" role="status"><p>${escapeHtml(message)}</p></section>` : ""}

    <div class="event-detail-layout">
      <section class="admin-panel event-detail-main-card">
        <div class="admin-panel-heading">
          <div><p class="eyebrow">Reservation Record</p><h2>${escapeHtml(booking.client_full_name)}</h2></div>
          <span class="status-pill status-${escapeHtml(booking.status)}">${escapeHtml(statusLabel(booking.status))}</span>
        </div>
        <dl class="admin-order-details event-detail-grid">
          ${detail("Booking source", booking.booking_source)}
          ${detail("Organization", booking.organization)}
          ${detail("Email", booking.email)}
          ${detail("Phone", booking.phone)}
          ${detail("Address", booking.address)}
          ${detail("Hall", booking.hall_name)}
          ${detail("Hall type", booking.hall_type)}
          ${detail("Event", displayEventType(booking))}
          ${detail("Date", formatEventDate(booking.event_date))}
          ${detail("Time", `${formatEventTime(booking.start_time)} to ${formatEventTime(booking.end_time)}`)}
          ${detail("Attendees", booking.attendees)}
          ${detail("Payment method", statusLabel(booking.payment_method))}
          ${detail("Payment reference", booking.payment_reference)}
          ${detail("Payment status", statusLabel(booking.payment_status))}
          ${detail("Email status", statusLabel(booking.email_status))}
          ${detail("Created", new Intl.DateTimeFormat("en-ET", { dateStyle: "medium", timeStyle: "short" }).format(new Date(booking.created_at)))}
        </dl>
        <div class="event-detail-section"><h3>Refreshments and Services</h3>${serviceMarkup()}</div>
        ${booking.special_requests ? `<div class="event-detail-section"><h3>Additional Requests</h3><p>${escapeHtml(booking.special_requests)}</p></div>` : ""}
        ${booking.decline_reason ? `<div class="event-detail-section event-detail-warning"><h3>Cancellation or Decline Reason</h3><p>${escapeHtml(booking.decline_reason)}</p></div>` : ""}
      </section>

      <aside class="event-detail-sidebar">
        <section class="admin-card">
          <h2>Documents</h2>
          <div class="event-detail-document-list">
            ${booking.payment_screenshot_display_url ? `<a href="${escapeHtml(booking.payment_screenshot_display_url)}" target="_blank" rel="noopener">Open Payment Proof</a>` : "<span>No payment proof supplied</span>"}
            ${booking.confirmation_pdf_display_url ? `<a href="${escapeHtml(booking.confirmation_pdf_display_url)}" target="_blank" rel="noopener">Open Stored Confirmation PDF</a>` : "<span>Stored PDF not available</span>"}
          </div>
          ${booking.payment_screenshot_display_url ? `<a class="admin-screenshot-link" href="${escapeHtml(booking.payment_screenshot_display_url)}" target="_blank" rel="noopener"><img src="${escapeHtml(booking.payment_screenshot_display_url)}" alt="Payment confirmation preview" /></a>` : ""}
        </section>

        <section class="admin-card">
          <h2>Update Status</h2>
          <form class="event-detail-status-form" data-detail-status-form>
            <label>Booking status<select name="status">
              ${["pending", "confirmed", "completed", "cancelled"].map((value) => `<option value="${value}" ${booking.status === value ? "selected" : ""}>${statusLabel(value)}</option>`).join("")}
            </select></label>
            <label>Payment status<select name="paymentStatus">
              ${["not_submitted", "pending_payment_confirmation", "verified", "declined"].map((value) => `<option value="${value}" ${booking.payment_status === value ? "selected" : ""}>${statusLabel(value)}</option>`).join("")}
            </select></label>
            <label>Cancellation / decline reason<textarea name="declineReason" rows="3">${escapeHtml(booking.decline_reason || "")}</textarea></label>
            <button class="btn btn-primary" type="submit">Save Status</button>
          </form>
        </section>

        <section class="admin-card">
          <h2>Confirmation Email</h2>
          <p>${booking.email ? `Send or resend the official summary and stored PDF to ${escapeHtml(booking.email)}.` : "No client email address was supplied."}</p>
          <button class="btn btn-light" type="button" data-detail-resend ${booking.email ? "" : "disabled"}>Resend Confirmation Email</button>
        </section>
      </aside>
    </div>
    <p class="admin-status" role="status" aria-live="polite"></p>
  `);
  bindDetailActions();
}

function bindDetailActions() {
  const status = document.querySelector(".admin-status");
  const refreshConfirmation = async (options = {}) => {
    const confirmation = await generateEventHallOfficialConfirmation(booking, "", options);
    booking.confirmation_pdf_display_url = confirmation.signedUrl;
    return confirmation;
  };
  document.querySelector("[data-detail-signout]")?.addEventListener("click", async () => {
    await signOutAdmin();
    window.location.replace("./admin-login.html?message=signed-out");
  });
  document.querySelector("[data-detail-download]")?.addEventListener("click", async () => {
    try {
      status.textContent = "Preparing secure confirmation PDF...";
      await refreshConfirmation({ regenerate: true });
      await downloadEventHallConfirmationPdf(booking);
      status.textContent = "Confirmation PDF downloaded.";
    } catch (error) {
      status.textContent = error.message || "Could not generate the PDF.";
    }
  });
  document.querySelector("[data-detail-print]")?.addEventListener("click", async () => {
    const preparedWindow = window.open("", "_blank");
    try {
      status.textContent = "Opening the printable confirmation...";
      await refreshConfirmation({ regenerate: true });
      await openPrintableEventHallConfirmation(booking, preparedWindow);
      status.textContent = "Confirmation opened for printing.";
    } catch (error) {
      preparedWindow?.close();
      status.textContent = error.message || "Could not open the printable confirmation.";
    }
  });
  document.querySelector("[data-detail-status-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      status.textContent = "Saving booking status...";
      await updateEventHallBookingStatus(booking.id, values.status, values.paymentStatus, values.declineReason);
      booking = await getEventHallBookingById(booking.id);
      renderDetail("Booking and payment status updated successfully.");
    } catch (error) {
      status.textContent = error.message || "Could not update the booking status.";
    }
  });
  document.querySelector("[data-detail-resend]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      status.textContent = "Sending confirmation email...";
      await sendEventHallConfirmationEmail(booking, { resend: true });
      booking = await getEventHallBookingById(booking.id);
      renderDetail("Confirmation email sent successfully.");
    } catch (error) {
      status.textContent = error.message || "The confirmation email could not be sent.";
      button.disabled = false;
    }
  });
}

async function init() {
  if (!isBackendReady()) {
    renderError("Supabase is not configured for this site.");
    return;
  }
  if (!bookingId) {
    renderError("No event hall booking was selected.");
    return;
  }

  renderLoading();
  try {
    adminProfile = await requireAdminAccess();
    booking = await getEventHallBookingById(bookingId);
    renderDetail();
  } catch (error) {
    if (/sign in|admin/i.test(error.message || "")) {
      const next = encodeURIComponent(`event-booking-detail.html?id=${bookingId}`);
      window.location.replace(`./admin-login.html?next=${next}&message=login-required`);
      return;
    }
    renderError(error.message || "This event hall booking could not be loaded.");
  }
}

init();
