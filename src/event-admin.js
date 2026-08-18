import { Navbar } from "./components.js?v=20260815-event-hall-v1";
import { images, siteConfig } from "./data.js?v=20260815-event-hall-v1";
import {
  collectEventBookingForm,
  createEventSubmissionToken,
  displayEventType,
  escapeHtml,
  eventBookingFormMarkup,
  formatEventDate,
  formatEventTime,
  formatEventTimeRange,
  validateEventBooking,
  wireEventBookingForm,
} from "./event-booking-core.js?v=20260818-event-request-v4";
import { eventAdminRequest, requireEventAdminAccess } from "./event-api.js?v=20260818-event-request-v4";
import { isBackendReady, signOutAdmin } from "./supabase-api.js?v=20260818-event-request-v4";

const app = document.querySelector("#event-admin-app");
const state = { profile: null, bookings: [], halls: [], legacyRequests: [], filter: "pending_review", search: "", creating: false };
const sections = [
  ["pending_review", "Pending Requests"],
  ["needs_information", "Needs Information"],
  ["approved_awaiting_payment", "Awaiting Payment"],
  ["payment_submitted", "Payment Submitted"],
  ["confirmed", "Confirmed"],
  ["completed", "Completed"],
  ["closed", "Rejected / Cancelled"],
];

function normalizedStatus(value) {
  return value === "pending" ? "pending_review" : value;
}

function humanStatus(value) {
  const labels = {
    pending_review: "Pending Review",
    needs_information: "Needs Information",
    approved_awaiting_payment: "Awaiting Payment",
    payment_submitted: "Payment Submitted",
    confirmed: "Confirmed",
    completed: "Completed",
    rejected: "Rejected",
    cancelled: "Cancelled",
  };
  return labels[normalizedStatus(value)] || "Unknown";
}

function matchesFilter(booking) {
  const status = normalizedStatus(booking.status);
  const filterMatch = state.filter === "closed" ? ["rejected", "cancelled"].includes(status) : status === state.filter;
  const search = state.search.toLowerCase();
  const text = [booking.booking_reference, booking.client_full_name, booking.organization, booking.phone, booking.hall_name].join(" ").toLowerCase();
  return filterMatch && (!search || text.includes(search));
}

function requestCard(booking) {
  return `<article class="admin-order-card event-admin-request-card"><div class="admin-order-card-heading"><div><small>${escapeHtml(booking.booking_reference)}</small><h3>${escapeHtml(booking.client_full_name)}</h3></div><span class="status-pill status-${escapeHtml(normalizedStatus(booking.status))}">${escapeHtml(humanStatus(booking.status))}</span></div><dl class="admin-order-details"><div><dt>Hall</dt><dd>${escapeHtml(booking.hall_name)}</dd></div><div><dt>Date</dt><dd>${escapeHtml(formatEventDate(booking.event_date))}</dd></div><div><dt>Time</dt><dd>${escapeHtml(formatEventTimeRange(booking.start_time, booking.end_time))}</dd></div><div><dt>Event</dt><dd>${escapeHtml(displayEventType(booking))}</dd></div><div><dt>Attendees</dt><dd>${escapeHtml(booking.attendees)}</dd></div><div><dt>Source</dt><dd>${escapeHtml(booking.booking_source)}</dd></div></dl><div class="admin-card-actions"><a class="btn btn-primary" href="./event-booking-detail.html?id=${encodeURIComponent(booking.id)}">Open Request</a></div></article>`;
}

function legacyRequestCard(request) {
  const date = request.event_date ? formatEventDate(request.event_date) : "Date not provided";
  const time = request.start_time
    ? request.end_time
      ? formatEventTimeRange(request.start_time, request.end_time)
      : formatEventTime(request.start_time)
    : "Time not provided";
  const legacyStatus = request.status === "approved"
    ? "Approved"
    : request.status === "rejected"
      ? "Rejected"
      : "Pending Review";
  return `<article class="admin-order-card event-admin-request-card event-admin-legacy-card"><div class="admin-order-card-heading"><div><small>Legacy inquiry</small><h3>${escapeHtml(request.full_name)}</h3></div><span class="status-pill status-${escapeHtml(request.status || "pending")}">${escapeHtml(legacyStatus)}</span></div><dl class="admin-order-details"><div><dt>Service</dt><dd>${escapeHtml(request.service_type)}</dd></div><div><dt>Event</dt><dd>${escapeHtml(request.event_type || "Not provided")}</dd></div><div><dt>Date</dt><dd>${escapeHtml(date)}</dd></div><div><dt>Time</dt><dd>${escapeHtml(time)}</dd></div><div><dt>Guests</dt><dd>${escapeHtml(request.guests || "Not provided")}</dd></div><div><dt>Phone</dt><dd>${escapeHtml(request.phone)}</dd></div><div><dt>Email</dt><dd>${escapeHtml(request.email || "Not provided")}</dd></div><div><dt>Catering</dt><dd>${escapeHtml(request.catering_package || "Not provided")}</dd></div></dl>${request.message ? `<div class="event-detail-section"><h4>Original message</h4><p>${escapeHtml(request.message)}</p></div>` : ""}<p class="event-admin-legacy-note">Read-only preserved inquiry. Recreate it with “New Event Booking” when the Events Team is ready to move it into the request workflow.</p></article>`;
}

function createPanel() {
  return `<section class="admin-card event-admin-create" ${state.creating ? "" : "hidden"}><div class="admin-panel-heading"><div><p class="eyebrow">Manual Request</p><h2>New Event Booking</h2></div><button class="btn btn-light" type="button" data-close-create>Close</button></div>${eventBookingFormMarkup({ halls: state.halls, mode: "admin" })}</section>`;
}

function dashboard() {
  const visible = state.bookings.filter(matchesFilter);
  return `${Navbar("events")}<main class="admin-shell event-admin-shell" id="event-admin-main"><section class="admin-hero"><div><p class="eyebrow">Events Team</p><h1>Event Hall Requests</h1><p>Review customer requests, hold approved time slots, verify payment, and issue final confirmations.</p></div><img src="${images.logo}" alt="${siteConfig.brandName} logo" /></section><section class="admin-toolbar"><span class="admin-user">${escapeHtml(state.profile.full_name || state.profile.email)}</span><button class="btn btn-primary" type="button" data-open-create>+ New Event Booking</button><button class="btn btn-light" type="button" data-refresh>Refresh</button><button class="btn btn-light" type="button" data-signout>Sign Out</button></section>${createPanel()}<section class="event-admin-summary" aria-label="Event request counts">${sections.map(([value, label]) => { const count = state.bookings.filter((booking) => value === "closed" ? ["rejected", "cancelled"].includes(normalizedStatus(booking.status)) : normalizedStatus(booking.status) === value).length; return `<button type="button" class="event-admin-summary-item ${state.filter === value ? "is-active" : ""}" data-filter="${value}"><strong>${count}</strong><span>${escapeHtml(label)}</span></button>`; }).join("")}</section><section class="admin-panel"><div class="admin-panel-heading"><div><p class="eyebrow">${escapeHtml(sections.find(([value]) => value === state.filter)?.[1] || "Requests")}</p><h2>Event Hall records</h2></div><label class="admin-event-search">Search<input data-event-search type="search" value="${escapeHtml(state.search)}" placeholder="Reference, client, hall, or phone" /></label></div><div class="admin-order-grid">${visible.length ? visible.map(requestCard).join("") : `<p class="empty-state">No Event Hall requests in this section.</p>`}</div></section>${state.legacyRequests.length ? `<section class="admin-panel"><div class="admin-panel-heading"><div><p class="eyebrow">Preserved Data</p><h2>Legacy Event Inquiries</h2></div><span>${state.legacyRequests.length} preserved</span></div><p>These inquiries were submitted through the earlier general contact form. They are read-only here so no historical customer request is lost.</p><div class="admin-order-grid event-admin-legacy-grid">${state.legacyRequests.map(legacyRequestCard).join("")}</div></section>` : ""}<p class="admin-status" role="status" aria-live="polite"></p></main>`;
}

function render() {
  app.innerHTML = dashboard();
  document.querySelector("[data-header]")?.classList.add("is-scrolled");
  wire();
}

async function loadDashboard() {
  const result = await eventAdminRequest("dashboard");
  state.bookings = result.bookings || [];
  state.halls = result.halls || [];
  state.legacyRequests = result.legacyRequests || [];
  render();
}

function wireCreateForm() {
  const form = document.querySelector("[data-event-reservation-form]");
  if (!form) return;
  wireEventBookingForm(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = form.querySelector(".form-status");
    const request = collectEventBookingForm(form);
    const validation = validateEventBooking(request, state.halls);
    if (validation) {
      status.textContent = validation;
      return;
    }
    try {
      const button = form.querySelector("button[type='submit']");
      button.disabled = true;
      status.textContent = request.saveMode === "approve" ? "Creating the hold and sending payment instructions..." : "Saving the pending request...";
      await eventAdminRequest("create", {
        source: request.bookingSource,
        saveMode: request.saveMode,
        quotedAmount: request.quotedAmount,
        quotedCurrency: request.quotedCurrency,
        paymentInstructions: request.paymentInstructions,
        paymentDeadline: request.paymentDeadline ? new Date(request.paymentDeadline).toISOString() : null,
        request: { ...request, submissionToken: createEventSubmissionToken() },
      });
      state.creating = false;
      await loadDashboard();
    } catch (error) {
      status.textContent = error.message || "The Event Hall request could not be created.";
      form.querySelector("button[type='submit']").disabled = false;
    }
  });
}

function wire() {
  document.querySelector("[data-open-create]")?.addEventListener("click", () => { state.creating = true; render(); });
  document.querySelector("[data-close-create]")?.addEventListener("click", () => { state.creating = false; render(); });
  document.querySelector("[data-refresh]")?.addEventListener("click", loadDashboard);
  document.querySelector("[data-signout]")?.addEventListener("click", async () => { await signOutAdmin(); window.location.replace("./event-admin-login.html?message=signed-out"); });
  document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => { state.filter = button.dataset.filter; render(); }));
  document.querySelector("[data-event-search]")?.addEventListener("input", (event) => { state.search = event.target.value; render(); document.querySelector("[data-event-search]")?.focus(); });
  wireCreateForm();
}

async function init() {
  if (!isBackendReady()) {
    app.innerHTML = `<main class="admin-shell"><section class="admin-card"><h1>Connect Supabase</h1><p>The Events Team dashboard requires the configured Harla Hotel Supabase project.</p></section></main>`;
    return;
  }
  app.innerHTML = `<main class="admin-shell"><section class="admin-card"><h1>Opening Events Team dashboard...</h1></section></main>`;
  try {
    state.profile = await requireEventAdminAccess();
    await loadDashboard();
  } catch (error) {
    const next = encodeURIComponent("event-admin.html");
    window.location.replace(`./event-admin-login.html?next=${next}&message=${encodeURIComponent(error.message || "login-required")}`);
  }
}

init();
