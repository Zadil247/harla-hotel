import { images, siteConfig } from "./data.js?v=20260728-manual-payments";

const app = document.querySelector("#chapa-success-app");
const maxVerificationAttempts = 4;
const retryDelayMs = 2200;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatEtb(value) {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Number(value || 0))} ETB`;
}

function testBadge(booking) {
  return booking?.isTestBooking
    ? '<div class="chapa-test-badge">Test payment — no real money charged</div>'
    : "";
}

function resultHeader(eyebrow, title, message, booking) {
  return `
    <a class="payment-result-brand" href="./index.html">
      <img src="${images.logo}" alt="Harla Hotel" />
      <span>Harla Hotel</span>
    </a>
    ${testBadge(booking)}
    <p class="eyebrow">${escapeHtml(eyebrow)}</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="payment-result-lead">${escapeHtml(message)}</p>
  `;
}

function statusDetails(booking) {
  if (!booking?.bookingNumber) {
    return "";
  }

  return `
    <dl class="payment-result-details">
      <div><dt>Booking reference</dt><dd>${escapeHtml(booking.bookingNumber)}</dd></div>
      <div><dt>Customer name</dt><dd>${escapeHtml(booking.customerName || "-")}</dd></div>
      <div><dt>Room type</dt><dd>${escapeHtml(booking.roomName || "-")}</dd></div>
      <div><dt>Check-in date</dt><dd>${escapeHtml(booking.checkIn || "-")}</dd></div>
      <div><dt>Check-out date</dt><dd>${escapeHtml(booking.checkOut || "-")}</dd></div>
      <div><dt>Number of nights</dt><dd>${escapeHtml(booking.nights || "-")}</dd></div>
      <div><dt>Number of guests</dt><dd>${escapeHtml(booking.guests || "-")}</dd></div>
      <div><dt>Amount</dt><dd>${formatEtb(booking.amount)}</dd></div>
      <div><dt>Payment method</dt><dd>${escapeHtml(booking.paymentMethod || "Chapa")}</dd></div>
      <div><dt>Payment status</dt><dd>${escapeHtml(booking.paymentStatus || "pending")}</dd></div>
    </dl>
  `;
}

function actions(booking) {
  const statusUrl = booking?.bookingNumber
    ? `./booking-status.html?booking=${encodeURIComponent(booking.bookingNumber)}`
    : "./booking-status.html";
  return `
    <div class="payment-result-actions">
      <a class="btn btn-primary" href="${statusUrl}">Check Booking Status</a>
      <a class="btn btn-light" href="./index.html">Return to Harla Hotel</a>
    </div>
  `;
}

function renderConfirmed(booking) {
  app.innerHTML = `
    ${resultHeader(
      "Booking Confirmed",
      "Thank you for choosing Harla Hotel.",
      "Your Chapa payment was verified by the secure payment server and your booking is confirmed.",
      booking,
    )}
    ${statusDetails(booking)}
    <div class="payment-result-note">
      Keep your booking reference for check-in. Confirmation email delivery is not enabled in this test phase.
    </div>
    ${actions(booking)}
  `;
}

function renderPending(booking) {
  app.innerHTML = `
    ${resultHeader(
      "Payment Pending",
      "Your payment is still being verified.",
      "Chapa has not confirmed this transaction yet. No booking confirmation has been issued.",
      booking,
    )}
    ${statusDetails(booking)}
    <div class="payment-result-note">
      You can check again shortly or contact Harla Hotel with your booking reference.
    </div>
    ${actions(booking)}
  `;
}

function renderFailed(message, booking = null) {
  app.innerHTML = `
    ${resultHeader(
      "Payment Not Confirmed",
      "We could not confirm this Chapa payment.",
      message,
      booking,
    )}
    ${statusDetails(booking)}
    <div class="payment-result-actions">
      <a class="btn btn-primary" href="./room-booking.html">Return to Room Booking</a>
      <a class="btn btn-light" href="tel:${siteConfig.phone.replace(/\s/g, "")}">Call ${siteConfig.phone}</a>
    </div>
  `;
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function verifyTransaction(txRef) {
  let lastBooking = null;

  for (let attempt = 1; attempt <= maxVerificationAttempts; attempt += 1) {
    const response = await fetch(
      `/api/chapa-verify?tx_ref=${encodeURIComponent(txRef)}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
    );
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("The secure payment server returned an invalid response.");
    }

    if (data?.bookingNumber) {
      lastBooking = data;
    }
    if (response.ok && data.confirmed === true) {
      return { state: "confirmed", booking: data };
    }
    if (
      response.status === 202 ||
      ["initialized", "pending"].includes(
        String(data?.paymentStatus || "").toLowerCase(),
      )
    ) {
      if (attempt < maxVerificationAttempts) {
        await wait(retryDelayMs);
        continue;
      }
      return { state: "pending", booking: lastBooking || data };
    }
    if (
      ["failed", "cancelled"].includes(
        String(data?.paymentStatus || "").toLowerCase(),
      )
    ) {
      return { state: "failed", booking: lastBooking || data };
    }

    throw new Error(
      data?.error || "Chapa could not verify this transaction.",
    );
  }

  return { state: "pending", booking: lastBooking };
}

async function loadConfirmation() {
  const txRef = new URLSearchParams(window.location.search).get("tx_ref");
  if (!txRef || !/^[A-Za-z0-9._-]{8,120}$/.test(txRef)) {
    renderFailed("The Chapa transaction reference is missing or invalid.");
    return;
  }

  try {
    const result = await verifyTransaction(txRef);
    if (result.state === "confirmed") {
      renderConfirmed(result.booking);
      return;
    }
    if (result.state === "pending") {
      renderPending(result.booking);
      return;
    }
    renderFailed(
      "Chapa reported that this payment failed or was cancelled. Your room has not been confirmed.",
      result.booking,
    );
  } catch (error) {
    renderFailed(
      error.message ||
        "Secure payment verification is temporarily unavailable. Please contact Harla Hotel.",
    );
  }
}

loadConfirmation();
