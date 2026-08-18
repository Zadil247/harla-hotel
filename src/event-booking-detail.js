import { Footer, Navbar } from "./components.js?v=20260818-event-request-v5";
import { images, siteConfig } from "./data.js?v=20260818-event-request-v5";
import { displayEventType, escapeHtml, formatEventDate, formatEventTimeRange, normalizeEventServices } from "./event-booking-core.js?v=20260818-event-request-v5";
import { eventAdminRequest, generateEventAdminConfirmation, requireEventAdminAccess } from "./event-api.js?v=20260818-event-request-v5";
import { downloadEventHallConfirmationPdf, openPrintableEventHallConfirmation } from "./event-confirmation-pdf.js?v=20260815-event-hall-v1";
import { signOutAdmin } from "./supabase-api.js?v=20260818-event-request-v4";

const app = document.querySelector("#event-booking-detail-app");
const bookingId = new URLSearchParams(window.location.search).get("id") || "";
let booking = null;
let adminProfile = null;

const statusLabels = {
  pending: "Pending Review",
  pending_review: "Pending Review",
  needs_information: "Needs Information",
  approved_awaiting_payment: "Awaiting Payment",
  payment_submitted: "Payment Submitted",
  confirmed: "Confirmed",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
  not_submitted: "Not Submitted",
  pending_payment_confirmation: "Pending Verification",
  verified: "Verified",
  declined: "Needs Replacement",
};

function statusLabel(value) {
  return statusLabels[value] || String(value || "-").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function detail(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "-")}</dd></div>`;
}

function money() {
  return booking.quoted_amount
    ? `${Number(booking.quoted_amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${booking.quoted_currency || "ETB"}`
    : "Not quoted";
}

function shell(content) {
  app.innerHTML = `${Navbar("events")}<main class="admin-shell event-detail-shell" id="event-detail-main"><section class="admin-hero event-detail-hero"><div><p class="eyebrow">Events Team Request</p><h1>${escapeHtml(booking?.booking_reference || "Event Request")}</h1><p>Review requirements, prepare the custom quote, verify payment, and issue the final confirmation.</p></div><img src="${images.logo}" alt="${siteConfig.brandName} logo" /></section>${content}</main>${Footer({ email: siteConfig.eventsEmail })}`;
  document.querySelector("[data-header]")?.classList.add("is-scrolled");
}

function serviceMarkup() {
  const services = normalizeEventServices(booking.refreshments_services);
  return services.length
    ? `<ul class="admin-line-list">${services.map((service) => `<li><strong>${escapeHtml(service.name)}</strong>${service.quantity ? `: ${escapeHtml(service.quantity)} ${escapeHtml(String(service.quantityLabel || "quantity").toLowerCase())}` : ""}${service.notes ? `, ${escapeHtml(service.notes)}` : ""}</li>`).join("")}</ul>`
    : "<p>No refreshments or additional services selected.</p>";
}

function quoteForm() {
  if (!["pending", "pending_review", "needs_information"].includes(booking.status)) return "";
  return `<section class="admin-card"><h2>Approve and Send Payment Request</h2><form data-admin-action="approve_quote" class="event-detail-status-form"><label>Quoted amount<input name="quotedAmount" type="number" min="0.01" step="0.01" value="${escapeHtml(booking.quoted_amount || "")}" required /></label><label>Currency<select name="quotedCurrency"><option value="ETB">ETB</option><option value="USD">USD</option></select></label><label>Payment deadline<input name="paymentDeadline" type="datetime-local" /></label><label>Payment instructions<textarea name="paymentInstructions" rows="5" maxlength="3000" required>${escapeHtml(booking.payment_instructions || "")}</textarea></label><button class="btn btn-primary" type="submit">Approve and Send Payment Request</button></form></section>`;
}

function needsInfoForm() {
  if (!["pending", "pending_review", "needs_information", "approved_awaiting_payment"].includes(booking.status)) return "";
  return `<section class="admin-card"><h2>Request More Information</h2><form data-admin-action="needs_information" class="event-detail-status-form"><label>Information needed<textarea name="message" rows="3" maxlength="1500" required>${escapeHtml(booking.needs_information_message || "")}</textarea></label><button class="btn btn-light" type="submit">Save Information Request</button></form></section>`;
}

function paymentActions() {
  if (booking.status !== "payment_submitted") return "";
  return `<section class="admin-card"><h2>Payment Review</h2><p>Verify the private payment confirmation before confirming this reservation.</p><button class="btn btn-primary" type="button" data-transition="verify_confirm">Verify and Confirm Booking</button><form data-admin-action="request_replacement" class="event-detail-status-form"><label>Replacement reason<textarea name="reason" rows="3" required>Please upload a clearer or corrected payment confirmation.</textarea></label><button class="btn btn-light" type="submit">Request Replacement</button></form></section>`;
}

function finalActions() {
  if (!booking || !["confirmed", "completed"].includes(booking.status)) return "";
  return `<section class="admin-card"><h2>Official Confirmation</h2><p>The stored document is private and includes the official Harla Hotel stamp.</p><div class="event-detail-document-list"><button class="btn btn-light" type="button" data-detail-download>Regenerate and Download PDF</button><button class="btn btn-primary" type="button" data-detail-print>Regenerate and Print PDF</button></div>${booking.status === "confirmed" ? `<button class="btn btn-light" type="button" data-transition="complete">Mark Event Completed</button>` : ""}</section>`;
}

function renderDetail(message = "") {
  shell(`<section class="admin-toolbar event-detail-toolbar"><a class="btn btn-light" href="./event-admin.html">Back to Events Dashboard</a><span class="admin-user">${escapeHtml(adminProfile.full_name || adminProfile.email)}</span><button class="btn btn-light" type="button" data-detail-resend>Send / Resend Customer Email</button><button class="btn btn-light" type="button" data-detail-signout>Sign Out</button></section>${message ? `<section class="admin-card admin-notice" role="status"><p>${escapeHtml(message)}</p></section>` : ""}<div class="event-detail-layout"><section class="admin-panel event-detail-main-card"><div class="admin-panel-heading"><div><p class="eyebrow">${escapeHtml(booking.booking_reference)}</p><h2>${escapeHtml(booking.client_full_name)}</h2></div><span class="status-pill status-${escapeHtml(booking.status)}">${escapeHtml(statusLabel(booking.status))}</span></div><dl class="admin-order-details event-detail-grid">${detail("Booking source", booking.booking_source)}${detail("Organization", booking.organization)}${detail("Email", booking.email)}${detail("Phone", booking.phone)}${detail("Address", booking.address)}${detail("Hall", booking.hall_name)}${detail("Hall type", booking.hall_type)}${detail("Event", displayEventType(booking))}${detail("Date", formatEventDate(booking.event_date))}${detail("Time", formatEventTimeRange(booking.start_time, booking.end_time))}${detail("Attendees", booking.attendees)}${detail("Quoted amount", money())}${detail("Payment status", statusLabel(booking.payment_status))}${detail("Payment reference", booking.payment_reference)}${detail("Payment deadline", booking.payment_deadline ? new Intl.DateTimeFormat("en-ET", { dateStyle: "medium", timeStyle: "short" }).format(new Date(booking.payment_deadline)) : null)}${detail("Created", new Intl.DateTimeFormat("en-ET", { dateStyle: "medium", timeStyle: "short" }).format(new Date(booking.created_at)))}</dl><div class="event-detail-section"><h3>Refreshments and Services</h3>${serviceMarkup()}</div>${booking.special_requests ? `<div class="event-detail-section"><h3>Additional Requests</h3><p>${escapeHtml(booking.special_requests)}</p></div>` : ""}${booking.needs_information_message ? `<div class="event-detail-section event-detail-warning"><h3>Information Requested</h3><p>${escapeHtml(booking.needs_information_message)}</p></div>` : ""}${booking.decline_reason ? `<div class="event-detail-section event-detail-warning"><h3>Decision Reason</h3><p>${escapeHtml(booking.decline_reason)}</p></div>` : ""}</section><aside class="event-detail-sidebar"><section class="admin-card"><h2>Secure Documents</h2>${booking.payment_screenshot_display_url ? `<a class="admin-screenshot-link" href="${escapeHtml(booking.payment_screenshot_display_url)}" target="_blank" rel="noopener"><img src="${escapeHtml(booking.payment_screenshot_display_url)}" alt="Customer payment confirmation" /></a>` : `<p>No payment confirmation submitted.</p>`}${booking.confirmation_pdf_display_url ? `<a href="${escapeHtml(booking.confirmation_pdf_display_url)}" target="_blank" rel="noopener">Open Stored Confirmation PDF</a>` : ""}</section>${quoteForm()}${needsInfoForm()}${paymentActions()}${finalActions()}${!["completed", "rejected", "cancelled"].includes(booking.status) ? `<section class="admin-card"><h2>Release or Reject</h2><form data-admin-action="${["pending", "pending_review", "needs_information"].includes(booking.status) ? "reject" : "cancel"}" class="event-detail-status-form"><label>Reason<textarea name="reason" rows="3" required></textarea></label><button class="btn btn-light" type="submit">${["pending", "pending_review", "needs_information"].includes(booking.status) ? "Mark Not Available" : "Cancel and Release Hold"}</button></form></section>` : ""}</aside></div><p class="admin-status" role="status" aria-live="polite"></p>`);
  wire();
}

async function reload(message = "") {
  const result = await eventAdminRequest("detail", { bookingId });
  booking = result.booking;
  renderDetail(message);
}

async function transition(action, values = {}) {
  const status = document.querySelector(".admin-status");
  try {
    status.textContent = "Updating the Event Hall request...";
    if (action === "approve_quote" && values.paymentDeadline) {
      values.paymentDeadline = new Date(values.paymentDeadline).toISOString();
    }
    await eventAdminRequest("transition", { bookingId, transition: action, values });
    await reload(action === "verify_confirm" ? "Payment verified. Booking confirmed and official PDF prepared." : "Event Hall request updated successfully.");
  } catch (error) {
    status.textContent = error.message || "The Event Hall request could not be updated.";
  }
}

function wire() {
  document.querySelector("[data-detail-signout]")?.addEventListener("click", async () => { await signOutAdmin(); window.location.replace("./event-admin-login.html?message=signed-out"); });
  document.querySelectorAll("[data-admin-action]").forEach((form) => form.addEventListener("submit", (event) => { event.preventDefault(); transition(form.dataset.adminAction, Object.fromEntries(new FormData(form).entries())); }));
  document.querySelectorAll("[data-transition]").forEach((button) => button.addEventListener("click", () => transition(button.dataset.transition)));
  document.querySelector("[data-detail-resend]")?.addEventListener("click", async () => {
    const status = document.querySelector(".admin-status");
    try {
      status.textContent = "Sending a fresh secure customer link...";
      await eventAdminRequest("resend", { bookingId });
      status.textContent = "Customer email sent with a newly rotated secure portal link.";
    } catch (error) {
      status.textContent = error.message || "The customer email could not be sent.";
    }
  });
  const refreshConfirmation = async (options = {}) => {
    const confirmation = await generateEventAdminConfirmation(
      booking.booking_reference,
      Boolean(options.regenerate),
    );
    booking.confirmation_pdf_display_url = confirmation.signedUrl;
  };
  document.querySelector("[data-detail-download]")?.addEventListener("click", async () => {
    const status = document.querySelector(".admin-status");
    try {
      status.textContent = "Regenerating the trusted confirmation PDF...";
      await refreshConfirmation({ regenerate: true });
      await downloadEventHallConfirmationPdf(booking);
      status.textContent = "Confirmation PDF downloaded.";
    } catch (error) {
      status.textContent = error.message || "The official PDF could not be generated.";
    }
  });
  document.querySelector("[data-detail-print]")?.addEventListener("click", async () => {
    const preparedWindow = window.open("", "_blank");
    const status = document.querySelector(".admin-status");
    try {
      status.textContent = "Regenerating the trusted printable confirmation...";
      await refreshConfirmation({ regenerate: true });
      await openPrintableEventHallConfirmation(booking, preparedWindow);
    } catch (error) {
      preparedWindow?.close();
      status.textContent = error.message || "The official PDF could not be opened.";
    }
  });
}

async function init() {
  if (!bookingId) {
    shell(`<section class="admin-card"><h2>No Event Hall request selected</h2><a class="btn btn-primary" href="./event-admin.html">Return to Events Dashboard</a></section>`);
    return;
  }
  shell(`<section class="admin-card"><h2>Loading Event Hall request...</h2></section>`);
  try {
    adminProfile = await requireEventAdminAccess();
    await reload();
  } catch (error) {
    const next = encodeURIComponent(`event-booking-detail.html?id=${bookingId}`);
    window.location.replace(`./event-admin-login.html?next=${next}&message=${encodeURIComponent(error.message || "login-required")}`);
  }
}

init();
