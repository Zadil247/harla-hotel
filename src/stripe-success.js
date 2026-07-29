import { images, siteConfig } from "./data.js?v=20260727-stripe-checkout";

const app = document.querySelector("#stripe-success-app");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

function resultHeader(eyebrow, title, message) {
  return `
    <a class="payment-result-brand" href="./index.html">
      <img src="${images.logo}" alt="Harla Hotel" />
      <span>Harla Hotel</span>
    </a>
    <p class="eyebrow">${escapeHtml(eyebrow)}</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="payment-result-lead">${escapeHtml(message)}</p>
  `;
}

function renderError(message) {
  app.innerHTML = `
    ${resultHeader(
      "Payment Verification",
      "We could not verify this checkout yet.",
      message,
    )}
    <div class="payment-result-actions">
      <a class="btn btn-primary" href="./book-room.html">Return to Room Booking</a>
      <a class="btn btn-light" href="tel:${siteConfig.phone.replace(/\s/g, "")}">Call ${siteConfig.phone}</a>
    </div>
  `;
}

function renderRoomUnavailable(booking) {
  app.innerHTML = `
    ${resultHeader(
      "Payment Refunded",
      "The selected room became unavailable.",
      "Your payment was received after the last room was taken. A Stripe refund has been requested automatically, and Harla Hotel has not confirmed this booking.",
    )}
    <dl class="payment-result-details">
      <div><dt>Booking reference</dt><dd>${escapeHtml(booking?.booking_number || "-")}</dd></div>
      <div><dt>Room type</dt><dd>${escapeHtml(booking?.room_type || "-")}</dd></div>
      <div><dt>Payment status</dt><dd>Refund initiated</dd></div>
      <div><dt>Booking status</dt><dd>Not confirmed</dd></div>
    </dl>
    <div class="payment-result-actions">
      <a class="btn btn-primary" href="./book-room.html">Choose Another Room</a>
      <a class="btn btn-light" href="mailto:${siteConfig.email}">Contact Harla Hotel</a>
    </div>
  `;
}

function renderSuccess(booking) {
  app.innerHTML = `
    ${resultHeader(
      "Booking Confirmed",
      "Thank you for choosing Harla Hotel.",
      "Your international card payment has been verified and your room is confirmed.",
    )}
    <dl class="payment-result-details">
      <div><dt>Booking reference number</dt><dd>${escapeHtml(booking.booking_number)}</dd></div>
      <div><dt>Customer name</dt><dd>${escapeHtml(booking.full_name)}</dd></div>
      <div><dt>Room type</dt><dd>${escapeHtml(booking.room_type)}</dd></div>
      <div><dt>Check-in date</dt><dd>${escapeHtml(booking.check_in)}</dd></div>
      <div><dt>Check-out date</dt><dd>${escapeHtml(booking.check_out)}</dd></div>
      <div><dt>Number of nights</dt><dd>${escapeHtml(booking.nights)}</dd></div>
      <div><dt>Number of guests</dt><dd>${escapeHtml(booking.guests)}</dd></div>
      <div><dt>Amount paid</dt><dd>${formatUsd(booking.total_price_usd)}</dd></div>
      <div><dt>Payment status</dt><dd>${escapeHtml(booking.payment_status)}</dd></div>
      <div><dt>Booking status</dt><dd>${escapeHtml(booking.status)}</dd></div>
    </dl>
    <div class="payment-result-note">
      Keep your booking reference for check-in. Confirmation email and PDF delivery are not enabled in this phase.
    </div>
    <div class="payment-result-actions">
      <a class="btn btn-primary" href="./index.html">Return to Harla Hotel</a>
      <a class="btn btn-light" href="tel:${siteConfig.phone.replace(/\s/g, "")}">Call ${siteConfig.phone}</a>
    </div>
  `;
}

async function loadConfirmation() {
  const sessionId = new URLSearchParams(window.location.search).get("session_id");
  if (!sessionId) {
    renderError("The Stripe Checkout session reference is missing.");
    return;
  }

  try {
    const response = await fetch(
      `/api/stripe-session?session_id=${encodeURIComponent(sessionId)}`,
      { headers: { Accept: "application/json" } },
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Payment verification failed.");
    }

    if (data.fulfillment?.roomUnavailable) {
      renderRoomUnavailable(data.booking);
      return;
    }
    if (
      !data.fulfillment?.confirmed ||
      data.booking?.payment_status !== "paid" ||
      data.booking?.status !== "confirmed"
    ) {
      renderError(
        "Stripe has not confirmed this payment yet. Please refresh shortly or contact Harla Hotel with your booking reference.",
      );
      return;
    }

    renderSuccess(data.booking);
  } catch (error) {
    renderError(
      error.message ||
        "Secure payment verification is temporarily unavailable. Please contact Harla Hotel.",
    );
  }
}

loadConfirmation();
