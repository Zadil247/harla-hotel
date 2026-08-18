import { Footer, Navbar } from "./components.js?v=20260818-event-request-v5";
import { siteConfig, whatsappLinks } from "./data.js?v=20260818-event-request-v5";
import { escapeHtml, formatEventDate, formatEventTimeRange, normalizeEventServices } from "./event-booking-core.js?v=20260818-event-request-v5";
import { lookupEventRequest, submitEventPaymentProof } from "./event-api.js?v=20260818-event-request-v5";
import {
  forgetPortalAccess,
  portalAccessFromUrl,
  recoverPortalAccess,
  rememberPortalAccess,
  sanitizedPortalLocation,
  validPortalAccess,
} from "./event-portal-access.js?v=20260818-event-request-v5";

const app = document.querySelector("#event-request-app");
const emailedAccess = portalAccessFromUrl(window.location.href);
const eventsEmail = siteConfig.eventsEmail;
const state = {
  reference: "",
  token: "",
  credentialSource: "",
  request: null,
  loading: false,
  accessState: "idle",
  error: "",
  message: "",
};

function humanPaymentStatus(value) {
  const labels = {
    not_submitted: "No Payment Required Yet",
    pending_payment_confirmation: "Payment Pending Verification",
    verified: "Payment Verified",
    declined: "Payment Confirmation Needs Replacement",
  };
  return labels[value] || "Payment Status Unavailable";
}

function statusCopy(request) {
  const messages = {
    pending_review: "Your request is with the Harla Hotel Events Team. No payment is required yet.",
    needs_information: request.needsInformationMessage || "The Events Team needs more information before reviewing the request.",
    approved_awaiting_payment: "Your event request is approved and the selected time is being held. Complete the payment instructions below before the deadline.",
    payment_submitted: "Your payment confirmation was received and is awaiting verification.",
    confirmed: "Your Event Hall booking is confirmed. Your official confirmation is available below.",
    rejected: request.declineReason || "The requested arrangement is not available. Please contact Harla Hotel to discuss alternatives.",
    cancelled: request.declineReason || "This reservation has been cancelled.",
    completed: "This event has been completed. Thank you for choosing Harla Hotel.",
  };
  return messages[request.status] || "Contact the Harla Hotel Events Team for the latest request information.";
}

function money(request) {
  return request.quotedAmount
    ? `${Number(request.quotedAmount).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${request.quotedCurrency || "ETB"}`
    : "Price pending review";
}

function serviceList(request) {
  const services = normalizeEventServices(request.refreshmentsServices);
  return services.length
    ? `<ul class="event-portal-services">${services.map((service) => `<li><strong>${escapeHtml(service.name)}</strong>${service.quantity ? `: ${escapeHtml(service.quantity)} ${escapeHtml(String(service.quantityLabel || "quantity").toLowerCase())}` : ""}</li>`).join("")}</ul>`
    : "<p>No refreshments or additional services selected.</p>";
}

function accessMessage() {
  const invalid = state.accessState === "invalid";
  const genericError = state.accessState === "error";
  const title = invalid ? "Secure link unavailable" : genericError ? "Request temporarily unavailable" : "Open your secure event request";
  const copy = invalid
    ? "This secure request link is no longer valid. Please use the most recent email sent by Harla Hotel Events or contact our Events Team."
    : genericError
      ? "We could not open your request right now. Please try the secure link again or contact our Events Team."
      : "Open the most recent secure link sent by Harla Hotel Events. This device will remember a validated request for future visits.";
  return `
    <section class="event-portal-access" aria-labelledby="portal-access-title">
      <p class="eyebrow">Secure Request Portal</p>
      <h1 id="portal-access-title">${title}</h1>
      <p>${copy}</p>
      ${state.error ? `<p class="event-page-message is-error" role="alert">${escapeHtml(state.error)}</p>` : ""}
      <div class="event-portal-recovery" aria-label="Events Team contact details">
        <a href="mailto:${eventsEmail}">${eventsEmail}</a>
        <a href="tel:${siteConfig.phone.replaceAll(" ", "")}">${siteConfig.phone}</a>
      </div>
      <a class="btn btn-primary" href="./event-hall.html">Return to Event Hall</a>
    </section>`;
}

function paymentForm(request) {
  if (request.status !== "approved_awaiting_payment") return "";
  return `
    <section class="event-portal-action" aria-labelledby="event-payment-title">
      <div><p class="eyebrow">Action Required</p><h2 id="event-payment-title">Submit Payment Confirmation</h2></div>
      <p class="event-payment-amount">${escapeHtml(money(request))}</p>
      ${request.paymentDeadline ? `<p><strong>Payment deadline:</strong> ${escapeHtml(new Intl.DateTimeFormat("en-ET", { dateStyle: "long", timeStyle: "short" }).format(new Date(request.paymentDeadline)))}</p>` : ""}
      <div class="event-payment-instructions"><strong>Payment instructions</strong><span>${escapeHtml(request.paymentInstructions || "Contact Harla Hotel for current payment instructions.")}</span></div>
      <form data-event-payment-form>
        <label>Payment reference<input name="paymentReference" maxlength="160" placeholder="Transaction or transfer reference" required /></label>
        <label class="event-upload-field">Payment confirmation<input name="paymentProof" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" required /><span data-event-proof-name>JPG, PNG, or WebP, up to 5 MB</span></label>
        <button class="btn btn-primary" type="submit">Submit Payment Confirmation</button>
        <p class="form-status" role="status" aria-live="polite"></p>
      </form>
    </section>`;
}

function requestView() {
  const request = state.request;
  return `
    <section class="event-portal-status" aria-labelledby="portal-status-title">
      <div class="event-portal-status-heading">
        <div><p class="eyebrow">${escapeHtml(request.bookingReference)}</p><h1 id="portal-status-title">${escapeHtml(request.statusLabel)}</h1></div>
        <span class="event-status-badge status-${escapeHtml(request.status)}">${escapeHtml(request.statusLabel)}</span>
      </div>
      <p class="event-portal-status-copy">${escapeHtml(statusCopy(request))}</p>
      ${state.message ? `<p class="event-page-message is-success" role="status">${escapeHtml(state.message)}</p>` : ""}
      <dl class="event-success-details event-portal-details">
        <div><dt>Client</dt><dd>${escapeHtml(request.clientFullName)}</dd></div>
        ${request.organization ? `<div><dt>Organization</dt><dd>${escapeHtml(request.organization)}</dd></div>` : ""}
        <div><dt>Hall</dt><dd>${escapeHtml(request.hallName)}</dd></div>
        <div><dt>Event date</dt><dd>${escapeHtml(formatEventDate(request.eventDate))}</dd></div>
        <div><dt>Time</dt><dd>${escapeHtml(formatEventTimeRange(request.startTime, request.endTime))}</dd></div>
        <div><dt>Attendees</dt><dd>${escapeHtml(request.attendees)}</dd></div>
        <div><dt>Quoted amount</dt><dd>${escapeHtml(money(request))}</dd></div>
        <div><dt>Payment status</dt><dd>${escapeHtml(humanPaymentStatus(request.paymentStatus))}</dd></div>
      </dl>
      <div class="event-detail-section"><h2>Refreshments and Services</h2>${serviceList(request)}</div>
      ${request.specialRequests ? `<div class="event-detail-section"><h2>Additional Requests</h2><p>${escapeHtml(request.specialRequests)}</p></div>` : ""}
      ${request.confirmationPdfUrl ? `<div class="event-portal-confirmation"><h2>Official Confirmation</h2><p>Your private stamped confirmation is ready.</p><a class="btn btn-primary" href="${escapeHtml(request.confirmationPdfUrl)}" target="_blank" rel="noopener">Download Confirmation PDF</a></div>` : ""}
      <div class="event-success-actions"><button class="btn btn-light" type="button" data-refresh-request>Refresh Status</button><a class="btn btn-whatsapp" href="${whatsappLinks.event}" target="_blank" rel="noopener">Contact Events Team</a></div>
    </section>
    ${paymentForm(request)}`;
}

function render() {
  app.innerHTML = `${Navbar("events")}<main class="event-portal-shell" id="event-request-main">${state.loading ? `<section class="event-portal-access"><p class="eyebrow">Secure Request Portal</p><h1>Opening your request...</h1><p>Validating your private email link securely.</p><div class="event-portal-loader" aria-hidden="true"></div></section>` : state.request ? requestView() : accessMessage()}</main>${Footer({ email: eventsEmail })}`;
  document.querySelector("[data-header]")?.classList.add("is-scrolled");
  wire();
}

async function loadRequest(access = { reference: state.reference, token: state.token }, source = state.credentialSource) {
  if (!validPortalAccess(access)) {
    state.accessState = "invalid";
    state.error = "The secure request link is invalid or incomplete.";
    render();
    return;
  }
  state.reference = access.reference;
  state.token = access.token;
  state.credentialSource = source;
  state.loading = true;
  state.error = "";
  render();
  try {
    const result = await lookupEventRequest(state.reference, state.token);
    state.request = result.request;
    state.accessState = "ready";
    rememberPortalAccess(localStorage, { reference: state.reference, token: state.token });
  } catch (error) {
    if (source === "stored") {
      forgetPortalAccess(localStorage, { reference: state.reference, token: state.token });
    }
    state.request = null;
    state.accessState = error.status === 404 ? "invalid" : "error";
    state.error = state.accessState === "error"
      ? "The request service is temporarily unavailable. Please try again shortly."
      : "";
    state.token = "";
  } finally {
    state.loading = false;
    render();
  }
}

function wire() {
  document.querySelector("[data-nav-toggle]")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    document.querySelector("[data-nav-menu]")?.classList.toggle("is-open");
  });
  document.querySelector("[data-refresh-request]")?.addEventListener("click", () => loadRequest());
  const paymentFormElement = document.querySelector("[data-event-payment-form]");
  paymentFormElement?.elements.paymentProof.addEventListener("change", (event) => {
    document.querySelector("[data-event-proof-name]").textContent = event.target.files[0]?.name || "JPG, PNG, or WebP, up to 5 MB";
  });
  paymentFormElement?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector(".form-status");
    const values = new FormData(form);
    const file = values.get("paymentProof");
    if (!file?.name) {
      status.textContent = "Please choose the payment confirmation file.";
      return;
    }
    try {
      form.querySelector("button").disabled = true;
      status.textContent = "Uploading payment confirmation securely...";
      const result = await submitEventPaymentProof(state.reference, state.token, values.get("paymentReference"), file);
      state.request = result.request;
      state.message = "Payment confirmation received. The Events Team will verify it shortly.";
      render();
    } catch (error) {
      status.textContent = error.message || "The payment confirmation could not be uploaded.";
      form.querySelector("button").disabled = false;
    }
  });
}

function initializePortal() {
  if (emailedAccess.hasSecureParameters) {
    history.replaceState({}, "", sanitizedPortalLocation(window.location.href));
    if (emailedAccess.hasToken && validPortalAccess(emailedAccess)) {
      loadRequest(emailedAccess, "url");
      return;
    }
    if (emailedAccess.hasReference && !emailedAccess.hasToken) {
      const legacySaved = recoverPortalAccess(localStorage, emailedAccess.reference);
      if (legacySaved?.reference === emailedAccess.reference) {
        loadRequest(legacySaved, "stored");
        return;
      }
    }
    state.accessState = "invalid";
    render();
    return;
  }

  const saved = recoverPortalAccess(localStorage);
  if (saved) {
    loadRequest(saved, "stored");
    return;
  }
  state.accessState = "missing";
  render();
}

initializePortal();
