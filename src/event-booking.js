import { Footer, Navbar } from "./components.js?v=20260815-event-hall-v1";
import { eventHallFallbacks, images, siteConfig, whatsappLinks } from "./data.js?v=20260815-event-hall-v1";
import {
  collectEventBookingForm,
  createEventSubmissionToken,
  escapeHtml,
  eventBookingFormMarkup,
  eventBookingSummaryMarkup,
  eventPaymentMethod,
  eventPaymentNeedsProof,
  formatEventDate,
  formatEventTime,
  validateEventBooking,
  wireEventBookingForm,
} from "./event-booking-core.js?v=20260815-event-hall-v1";
import {
  createEventHallBooking,
  generateEventHallOfficialConfirmation,
  getEventHalls,
  isBackendReady,
  sendEventHallConfirmationEmail,
  uploadEventHallPaymentProof,
} from "./supabase-api.js?v=20260815-event-hall-v1";
import {
  downloadEventHallConfirmationPdf,
  openPrintableEventHallConfirmation,
} from "./event-confirmation-pdf.js?v=20260815-event-hall-v1";

const app = document.querySelector("#event-booking-app");
const params = new URLSearchParams(window.location.search);
const requestedHall = params.get("hall") || "";

const state = {
  halls: eventHallFallbacks,
  catalogueSource: "fallback",
  stage: "form",
  submissionToken: createEventSubmissionToken(),
  payload: null,
  booking: null,
  pdfReady: false,
  pdfError: "",
  emailMessage: "",
  isSubmitting: false,
  isGeneratingPdf: false,
  pageMessage: "",
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
        [1, "Event Details"],
        [2, "Review"],
        [3, "Reference"],
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
  const payment = eventPaymentMethod(booking.payment_method);
  return `
    <section class="event-booking-success" aria-labelledby="event-success-title">
      <div class="event-success-mark" aria-hidden="true">✓</div>
      <p class="eyebrow">Request Received</p>
      <h2 id="event-success-title">Thank you for choosing Harla Hotel</h2>
      <p>
        Your event hall reservation request has been saved. The Harla Hotel events team will review
        the schedule, services, and payment information before confirming the reservation.
      </p>
      <div class="event-reference-panel">
        <span>Booking reference</span>
        <strong>${escapeHtml(booking.booking_reference)}</strong>
        <p>Keep this reference when contacting the hotel.</p>
      </div>
      <dl class="event-success-details">
        <div><dt>Client</dt><dd>${escapeHtml(booking.client_full_name)}</dd></div>
        ${booking.organization ? `<div><dt>Organization</dt><dd>${escapeHtml(booking.organization)}</dd></div>` : ""}
        <div><dt>Hall</dt><dd>${escapeHtml(booking.hall_name)}</dd></div>
        <div><dt>Event date</dt><dd>${escapeHtml(formatEventDate(booking.event_date))}</dd></div>
        <div><dt>Time</dt><dd>${escapeHtml(formatEventTime(booking.start_time))} to ${escapeHtml(formatEventTime(booking.end_time))}</dd></div>
        <div><dt>Attendees</dt><dd>${escapeHtml(booking.attendees)}</dd></div>
        <div><dt>Payment</dt><dd>${escapeHtml(payment.label)}</dd></div>
        <div><dt>Payment status</dt><dd>Pending verification or arrangement</dd></div>
        <div><dt>Reservation status</dt><dd>Pending review</dd></div>
      </dl>
      <div class="event-delivery-status" role="status" aria-live="polite">
        <p class="${state.pdfReady ? "is-success" : "is-warning"}">
          <strong>Confirmation letter:</strong>
          ${state.pdfReady ? "Ready to download or print." : escapeHtml(state.pdfError || "The booking is saved. Use Download or Print to retry the secure confirmation letter.")}
        </p>
        ${payload.email ? `
          <p class="${state.emailMessage.startsWith("Sent") ? "is-success" : "is-warning"}">
            <strong>Email:</strong> ${escapeHtml(state.emailMessage || "Confirmation email is being prepared.")}
          </p>
        ` : `<p><strong>Email:</strong> No email address was supplied.</p>`}
      </div>
      <div class="event-success-actions">
        <button class="btn btn-primary" type="button" data-download-event-pdf ${state.isGeneratingPdf ? "disabled" : ""}>Download Confirmation Letter</button>
        <button class="btn btn-light" type="button" data-print-event-pdf ${state.isGeneratingPdf ? "disabled" : ""}>Print Confirmation Letter</button>
        <a class="btn btn-whatsapp" href="${whatsappLinks.event}" target="_blank" rel="noopener">Contact Events Team</a>
        <button class="text-link event-start-again" type="button" data-event-start-again>Start Another Booking</button>
      </div>
      <p class="event-success-contact">Questions? Call <a href="tel:${siteConfig.phone.replaceAll(" ", "")}">${siteConfig.phone}</a> or email <a href="mailto:${siteConfig.email}">${siteConfig.email}</a>.</p>
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
          <h1>Event Hall Reservation</h1>
          <p>Submit one complete request for the hall, schedule, attendance, refreshments, and payment arrangement.</p>
        </div>
        <img src="${images.logo}" alt="${siteConfig.brandName} logo" />
      </section>
      ${stepper()}
      ${state.pageMessage ? `<p class="event-page-message" role="status">${escapeHtml(state.pageMessage)}</p>` : ""}
      ${state.stage === "form" ? formStage() : state.stage === "review" ? reviewStage() : successStage()}
    </main>
    ${Footer()}
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

  document.querySelector("[data-download-event-pdf]")?.addEventListener("click", () => {
    runPdfAction("download");
  });
  document.querySelector("[data-print-event-pdf]")?.addEventListener("click", () => {
    const preparedWindow = window.open("", "_blank");
    runPdfAction("print", preparedWindow);
  });
  document.querySelector("[data-event-start-again]")?.addEventListener("click", () => {
    state.stage = "form";
    state.submissionToken = createEventSubmissionToken();
    state.payload = { hallId: state.booking.hall_id };
    state.booking = null;
    state.pdfReady = false;
    state.pdfError = "";
    state.emailMessage = "";
    state.isGeneratingPdf = false;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

async function refreshOfficialConfirmation() {
  try {
    const confirmation = await generateEventHallOfficialConfirmation(
      state.booking,
      state.submissionToken,
    );
    state.booking.confirmation_pdf_display_url = confirmation.signedUrl;
    state.pdfReady = true;
    state.pdfError = "";
    return confirmation;
  } catch (error) {
    state.pdfReady = false;
    state.pdfError = error.message
      || "The secure confirmation letter could not be generated. Please try again or contact Harla Hotel.";
    throw new Error(state.pdfError);
  }
}

async function runPdfAction(action, preparedWindow = null) {
  if (state.isGeneratingPdf) {
    preparedWindow?.close();
    return;
  }

  state.isGeneratingPdf = true;
  state.pageMessage = "";
  document.querySelectorAll("[data-download-event-pdf], [data-print-event-pdf]")
    .forEach((button) => {
      button.disabled = true;
    });

  try {
    await refreshOfficialConfirmation();
    if (action === "print") {
      await openPrintableEventHallConfirmation(state.booking, preparedWindow);
    } else {
      await downloadEventHallConfirmationPdf(state.booking);
    }
  } catch (error) {
    preparedWindow?.close();
    state.pdfError = error.message
      || "The secure confirmation letter could not be opened. Please try again or contact Harla Hotel.";
  } finally {
    state.isGeneratingPdf = false;
    render();
  }
}

function handleReview(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = form.querySelector(".form-status");
  const payload = collectEventBookingForm(form);
  if (!payload.paymentProof?.name && state.payload?.paymentProof?.name) {
    payload.paymentProof = state.payload.paymentProof;
  }
  const validation = validateEventBooking(payload, state.halls, {
    existingPaymentProof: Boolean(payload.paymentProof?.name),
  });

  if (validation) {
    status.textContent = validation;
    return;
  }

  state.payload = payload;
  state.stage = "review";
  state.pageMessage = "";
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function submitBooking() {
  if (state.isSubmitting) {
    return;
  }

  const status = document.querySelector(".form-status");
  const button = document.querySelector("[data-confirm-event-booking]");
  const payload = state.payload;
  const hall = selectedHall();

  if (!isBackendReady() || state.catalogueSource !== "database") {
    status.textContent = "Online event reservations need the Event Hall Booking Supabase migration before submission. Please contact Harla Hotel for immediate assistance.";
    return;
  }

  try {
    state.isSubmitting = true;
    button.disabled = true;
    button.textContent = "Saving Reservation...";
    let paymentScreenshotPath = "";

    if (eventPaymentNeedsProof(payload.paymentMethod)) {
      status.textContent = "Uploading payment confirmation securely...";
      paymentScreenshotPath = await uploadEventHallPaymentProof(
        payload.paymentProof,
        state.submissionToken,
      );
    }

    status.textContent = "Checking hall availability and saving the reservation...";
    const booking = await createEventHallBooking({
      ...payload,
      submissionToken: state.submissionToken,
      paymentScreenshotPath,
    });

    state.booking = {
      ...booking,
      hall_id: payload.hallId,
      address: payload.address,
      payment_reference: payload.paymentReference,
      payment_screenshot_path: paymentScreenshotPath,
      refreshments_services: payload.refreshmentsServices,
      special_requests: payload.specialRequests,
      booking_source: booking.booking_source || "WEBSITE",
      hall_name: booking.hall_name || hall.name,
    };

    try {
      status.textContent = "Creating the official confirmation letter...";
      await refreshOfficialConfirmation();
    } catch (error) {
      console.error("Official event confirmation PDF could not be generated", error);
      state.pdfError = error.message
        || "The reservation is saved, but the confirmation letter could not be generated. Please use Download or Print to retry.";
    }

    if (state.booking.email) {
      try {
        const email = await sendEventHallConfirmationEmail(state.booking);
        state.emailMessage = email.sent
          ? "Sent to the supplied email address."
          : "No confirmation email was sent.";
      } catch (error) {
        state.emailMessage = error.message || "The reservation is saved, but confirmation email could not be sent.";
      }
    }

    state.stage = "success";
    state.pageMessage = "";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    status.textContent = error.message || "The event hall reservation could not be saved. Please contact Harla Hotel.";
    button.disabled = false;
    button.textContent = "Confirm Reservation";
  } finally {
    state.isSubmitting = false;
  }
}

async function loadPage() {
  if (isBackendReady()) {
    try {
      const halls = await getEventHalls();
      if (halls.length) {
        state.halls = halls;
        state.catalogueSource = "database";
      }
    } catch (error) {
      state.pageMessage = "The online hall catalogue is temporarily unavailable. You can review the form, or contact Harla Hotel to reserve immediately.";
      console.warn("Could not load event halls", error);
    }
  }
  render();
}

loadPage();
