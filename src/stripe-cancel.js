import { images, siteConfig } from "./data.js?v=20260727-stripe-checkout";

const app = document.querySelector("#stripe-cancel-app");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderResult(title, message, bookingNumber = "") {
  app.innerHTML = `
    <a class="payment-result-brand" href="./index.html">
      <img src="${images.logo}" alt="Harla Hotel" />
      <span>Harla Hotel</span>
    </a>
    <p class="eyebrow">International Card Payment</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="payment-result-lead">${escapeHtml(message)}</p>
    ${
      bookingNumber
        ? `<dl class="payment-result-details"><div><dt>Booking reference</dt><dd>${escapeHtml(bookingNumber)}</dd></div><div><dt>Booking status</dt><dd>Not confirmed</dd></div></dl>`
        : ""
    }
    <div class="payment-result-actions">
      <a class="btn btn-primary" href="./book-room.html">Try Room Booking Again</a>
      <a class="btn btn-light" href="tel:${siteConfig.phone.replace(/\s/g, "")}">Call ${siteConfig.phone}</a>
    </div>
  `;
}

async function closeCheckout() {
  const params = new URLSearchParams(window.location.search);
  const bookingNumber = params.get("booking") || "";
  const token = params.get("token") || "";

  if (!bookingNumber || !token) {
    renderResult(
      "Payment was not completed.",
      "No room has been confirmed or charged. You can return to booking or contact Harla Hotel.",
    );
    return;
  }

  try {
    const response = await fetch("/api/stripe-session", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bookingNumber, token }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "The cancelled checkout could not be closed.");
    }

    renderResult(
      "Your card checkout was cancelled.",
      data.message ||
        "Your room has not been confirmed or charged. You can start a new booking whenever you are ready.",
      data.bookingNumber,
    );
  } catch (error) {
    renderResult(
      "Payment was not completed.",
      error.message ||
        "Your room has not been confirmed. Please contact Harla Hotel if you need assistance.",
      bookingNumber,
    );
  }
}

closeCheckout();
