import { Footer, Navbar } from "./components.js?v=20260818-event-request-v5";
import { eventHallFallbacks, images, siteConfig, whatsappLinks } from "./data.js?v=20260818-event-request-v5";
import {
  collectEventBookingForm,
  createEventSubmissionToken,
  escapeHtml,
  eventBookingFormMarkup,
  eventBookingSummaryMarkup,
  formatEventDate,
  formatEventTimeRange,
  validateEventBooking,
  wireEventBookingForm,
} from "./event-booking-core.js?v=20260818-event-request-v5";
import {
  getEventHalls,
  isBackendReady,
} from "./supabase-api.js?v=20260818-event-request-v5";
import {
  checkEventRequestBackendReadiness,
  checkEventHallAvailability,
  submitEventHallRequest,
} from "./event-api.js?v=20260818-event-request-v5";
import { rememberPortalAccess } from "./event-portal-access.js?v=20260818-event-request-v5";

const app = document.querySelector("#event-booking-app");
const params = new URLSearchParams(window.location.search);
const requestedHall = params.get("hall") || "";

const state = {
  halls: eventHallFallbacks,
  catalogueSource: "fallback",
  backendReady: false,
  stage: "form",
  submissionToken: createEventSubmissionToken(),
  payload: null,
  booking: null,
  isSubmitting: false,
  pageMessage: "",
  portalUrl: "",
  emailDelivery: null,
};

function selectedHall() {
  return state.halls.find((hall) => String(hall.id) === String(state.payload?.hallId)) || null;
}

function requestedHallId() {
  return state.halls.find((hall) => hall.slug === requestedHall)?.id || state.halls[0]?.id || "";
}

function stepper() {
  const current = state.stage === "form" ? 1 : state.stage === "review" ? 2 : 3;
  return `
    <ol class="event-booking-stepper" aria-label="Event booking progress">
      ${[
        [1, "Event Request"],
        [2, "Review Request"],
        [3, "Request Received"],
      ].map(([number, label]) => `
        <li class="${current === number ? "is-active" : ""} ${current > number ? "is-complete" : ""}">
          <span>${current > number ? "✓" : number}</span><strong>${label}</strong>
        </li>
      `).join("")}
    </ol>
  `;
}

function formStage() {
  const values = state.payload || { hallId: requestedHallId() };
  return `
    <section class="event-booking-task" aria-labelledby="event-booking-form-title">
      <div class="event-booking-task-heading">
        <div>
          <p class="eyebrow">Reservation Request</p>
          <h2 id="event-booking-form-title">Tell us about the event</h2>
        </div>
        <p>Fields marked with * are required.</p>
      </div>
      ${eventBookingFormMarkup({ halls: state.halls, values, mode: "public" })}
    </section>
  `;
}

function reviewStage() {
  return eventBookingSummaryMarkup(state.payload, selectedHall());
}

function successStage() {
  const booking = state.booking;
  const payload = state.payload;
  const eventsEmail = siteConfig.eventsEmail;
  const emailMessage = state.emailDelivery?.sent
    ? `<p class="is-success"><strong>Email sent:</strong> A secure request link has been sent to ${escapeHtml(payload.email)}.</p>`
    : `<p class="is-warning"><strong>Email delivery:</strong> Your request was saved, but the secure email could not be delivered. Contact the Events Team at <a href="mailto:${eventsEmail}">${eventsEmail}</a> or <a href="tel:${siteConfig.phone.replaceAll(" ", "")}">${siteConfig.phone}</a>.</p>`;
  return `
    <section class="event-booking-success" aria-labelledby="event-success-title">
      <div class="event-success-mark" aria-hidden="true">✓</div>
      <p class="eyebrow">Request Received</p>
      <h2 id="event-success-title">Your event request has been received</h2>
      <p>
        Harla Hotel's Events Team will review availability and contact you shortly.
        No payment is required at this stage.
      </p>
      <div class="event-reference-panel">
        <span>Request reference</span>
        <strong>${escapeHtml(booking.booking_reference)}</strong>
        <p>Keep this reference and the secure portal link sent to your email.</p>
      </div>
      <dl class="event-success-details">
        <div><dt>Client</dt><dd>${escapeHtml(booking.client_full_name)}</dd></div>
        ${booking.organization ? `<div><dt>Organization</dt><dd>${escapeHtml(booking.organization)}</dd></div>` : ""}
        <div><dt>Hall</dt><dd>${escapeHtml(booking.hall_name)}</dd></div>
        <div><dt>Event date</dt><dd>${escapeHtml(formatEventDate(booking.event_date))}</dd></div>
        <div><dt>Time</dt><dd>${escapeHtml(formatEventTimeRange(booking.start_time, booking.end_time))}</dd></div>
        <div><dt>Attendees</dt><dd>${escapeHtml(booking.attendees)}</dd></div>
        <div><dt>Request status</dt><dd>Request Received - Pending Review</dd></div>
      </dl>
      <div class="event-delivery-status" role="status" aria-live="polite">
        <p class="is-success"><strong>Request saved:</strong> Your request is stored securely and can be opened again after closing this page.</p>
        ${emailMessage}
      </div>
      <div class="event-success-actions">
        <a class="btn btn-primary" href="${escapeHtml(state.portalUrl)}">View Request Status</a>
        <a class="btn btn-whatsapp" href="${whatsappLinks.event}" target="_blank" rel="noopener">Contact Events Team</a>
        <button class="text-link event-start-again" type="button" data-event-start-again>Submit Another Request</button>
      </div>
      <p class="event-success-contact">Questions? Call <a href="tel:${siteConfig.phone.replaceAll(" ", "")}">${siteConfig.phone}</a> or email <a href="mailto:${eventsEmail}">${eventsEmail}</a>.</p>
    </section>
  `;
}

function render() {
  app.innerHTML = `
    ${Navbar("events")}
    <main class="event-reservation-page" id="event-main">
      <section class="event-reservation-intro">
        <div>
          <p class="eyebrow">Harla Hotel Events</p>
          <h1>Request an Event Space</h1>
          <p>Tell the Events Team what you need. Pricing is customized, and no payment is required when submitting the request.</p>
        </div>
        <img src="${images.logo}" alt="${siteConfig.brandName} logo" />
      </section>
      ${stepper()}
      ${state.pageMessage ? `<p class="event-page-message" role="status">${escapeHtml(state.pageMessage)}</p>` : ""}
      ${state.stage === "form" ? formStage() : state.stage === "review" ? reviewStage() : successStage()}
    </main>
    ${Footer({ email: siteConfig.eventsEmail })}
  `;

  document.querySelector("[data-header]")?.classList.add("is-scrolled");
  wireNavigation();
  wireStage();
}

function wireNavigation() {
  const navToggle = document.querySelector("[data-nav-toggle]");
  const navMenu = document.querySelector("[data-nav-menu]");
  navToggle?.addEventListener("click", () => {
    const expanded = navToggle.getAttribute("aria-expanded") === "true";
    navToggle.setAttribute("aria-expanded", String(!expanded));
    navMenu?.classList.toggle("is-open");
  });
}

function wireStage() {
  if (state.stage === "form") {
    const form = document.querySelector("[data-event-reservation-form]");
    wireEventBookingForm(form);
    form.addEventListener("submit", handleReview);
    return;
  }

  if (state.stage === "review") {
    document.querySelector("[data-edit-event-booking]")?.addEventListener("click", () => {
      state.stage = "form";
      state.pageMessage = "";
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    document.querySelector("[data-confirm-event-booking]")?.addEventListener("click", submitBooking);
    return;
  }

  document.querySelector("[data-event-start-again]")?.addEventListener("click", () => {
    state.stage = "form";
    state.submissionToken = createEventSubmissionToken();
    state.payload = { hallId: state.booking.hall_id };
    state.booking = null;
    state.portalUrl = "";
    state.emailDelivery = null;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

async function handleReview(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = form.querySelector(".form-status");
  const payload = collectEventBookingForm(form);
  const validation = validateEventBooking(payload, state.halls);

  if (validation) {
    status.textContent = validation;
    return;
  }

  try {
    status.textContent = "Checking the selected hall and time...";
    const availability = await checkEventHallAvailability({
      hallId: payload.hallId,
      eventDate: payload.eventDate,
      startTime: payload.startTime,
      endTime: payload.endTime,
    });
    if (!availability.available) {
      status.textContent = "This hall is unavailable for the selected date and time. Please choose another time or contact Harla Hotel.";
      return;
    }
    state.payload = payload;
    state.stage = "review";
    state.pageMessage = "";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    status.textContent = error.message || "Hall availability could not be checked.";
  }
}

async function submitBooking() {
  if (state.isSubmitting) {
    return;
  }

  const status = document.querySelector(".form-status");
  const button = document.querySelector("[data-confirm-event-booking]");
  const payload = state.payload;
  const hall = selectedHall();

  if (!isBackendReady() || state.catalogueSource !== "database" || !state.backendReady) {
    status.textContent = "Online event reservations need the Event Hall Booking Supabase migration before submission. Please contact Harla Hotel for immediate assistance.";
    return;
  }

  try {
    state.isSubmitting = true;
    button.disabled = true;
    button.textContent = "Submitting Request...";
    status.textContent = "Checking availability and saving your event request...";
    const result = await submitEventHallRequest({
      ...payload,
      submissionToken: state.submissionToken,
    });
    state.booking = {
      booking_reference: result.request.bookingReference,
      client_full_name: result.request.clientFullName,
      organization: result.request.organization,
      hall_name: result.request.hallName || hall.name,
      event_date: result.request.eventDate,
      start_time: result.request.startTime,
      end_time: result.request.endTime,
      attendees: result.request.attendees,
      hall_id: payload.hallId,
    };
    state.portalUrl = "./event-request.html";
    state.emailDelivery = result.email || { sent: false };
    rememberPortalAccess(localStorage, {
      reference: result.request.bookingReference,
      token: result.portalToken,
    });

    state.stage = "success";
    state.pageMessage = "";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    status.textContent = error.message || "The event hall reservation could not be saved. Please contact Harla Hotel.";
    button.disabled = false;
    button.textContent = "Submit Event Request";
  } finally {
    state.isSubmitting = false;
  }
}

async function loadPage() {
  if (isBackendReady()) {
    try {
      const [halls, readiness] = await Promise.all([
        getEventHalls(),
        checkEventRequestBackendReadiness(),
      ]);
      if (halls.length) {
        state.halls = halls;
        state.catalogueSource = "database";
      }
      state.backendReady = readiness.ready === true;
      if (!state.backendReady) {
        state.pageMessage = "Online event requests are being prepared. You can review the form now or contact Harla Hotel for immediate assistance.";
      }
    } catch (error) {
      state.pageMessage = "The online hall catalogue is temporarily unavailable. You can review the form, or contact Harla Hotel to reserve immediately.";
      console.warn("Could not load event halls", error);
    }
  }
  render();
}

loadPage();
