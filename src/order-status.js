import { Footer, Navbar } from "./components.js?v=20260521-restaurant-workflow";
import { images, siteConfig, whatsappLinks } from "./data.js?v=20260521-restaurant-workflow";
import {
  backendSetupMessage,
  getRestaurantOrderStatus,
  isBackendReady,
} from "./supabase-api.js?v=20260521-restaurant-workflow";

const app = document.querySelector("#order-status-app");
const query = new URLSearchParams(window.location.search);
const initialOrderNumber = query.get("order") || "";
let currentOrderNumber = initialOrderNumber;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function orderStatusMessage(order) {
  if (!order) {
    return "";
  }

  if (order.status === "declined") {
    return "Declined";
  }

  if (order.status === "approved" && order.odoo_status === "entered") {
    return "Your order has been entered into our kitchen system.";
  }

  if (order.status === "approved") {
    return "Approved. Entered into Odoo / kitchen system soon.";
  }

  return "Pending approval";
}

function orderResult(order) {
  if (!order) {
    return "";
  }

  return `
    <section class="order-panel order-status-result">
      <p class="eyebrow">Order ${escapeHtml(order.order_number)}</p>
      <h2>${escapeHtml(orderStatusMessage(order))}</h2>
      <dl class="status-details">
        <div><dt>Order type</dt><dd>${escapeHtml(order.order_type)}</dd></div>
        <div><dt>Payment status</dt><dd>${escapeHtml(order.payment_status || "-")}</dd></div>
        <div><dt>Order status</dt><dd>${escapeHtml(order.status)}</dd></div>
        <div><dt>Kitchen system</dt><dd>${escapeHtml(order.odoo_status || "not_entered")}</dd></div>
      </dl>
      <p>
        If you need help with this order, contact Harla Hotel and share your order number.
      </p>
      <a class="btn btn-whatsapp" href="${whatsappLinks.table}" target="_blank" rel="noopener">Contact on WhatsApp</a>
    </section>
  `;
}

function render(message = "", order = null) {
  app.innerHTML = `
    ${Navbar("restaurant")}
    <main id="order-status-main" class="restaurant-order-shell">
      <section class="restaurant-order-hero compact-hero" style="--page-hero-image: url('${images.restaurant}')">
        <div class="page-hero-content reveal is-visible">
          <p class="eyebrow">Restaurant Order</p>
          <h1>Check Order Status</h1>
          <p>Enter your order number and phone number to see your Harla Hotel restaurant order status.</p>
        </div>
      </section>
      <div class="order-container">
        <section class="order-workspace status-workspace">
          <form class="booking-form order-status-form" id="order-status-form">
            <div class="section-heading">
              <p class="eyebrow">Private Lookup</p>
              <h2>Your order status</h2>
              <p>For privacy, the order number and phone number must match the order.</p>
            </div>
            <div class="form-grid">
              <label>
                Order number
                <input name="orderNumber" type="text" value="${escapeHtml(currentOrderNumber)}" placeholder="HRL-1001" required />
              </label>
              <label>
                Phone number
                <input name="phone" type="tel" autocomplete="tel" required />
              </label>
            </div>
            <button class="btn btn-primary" type="submit">Check Status</button>
            <p class="form-status" role="status" aria-live="polite">${escapeHtml(message)}</p>
          </form>
          ${orderResult(order)}
        </section>
      </div>
    </main>
    ${Footer()}
  `;

  document.querySelector("[data-header]")?.classList.add("is-scrolled");
  bindEvents();
}

function bindEvents() {
  const navToggle = document.querySelector("[data-nav-toggle]");
  const navMenu = document.querySelector("[data-nav-menu]");

  navToggle?.addEventListener("click", () => {
    const expanded = navToggle.getAttribute("aria-expanded") === "true";
    navToggle.setAttribute("aria-expanded", String(!expanded));
    navMenu.classList.toggle("is-open");
  });

  document.querySelector("#order-status-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = Object.fromEntries(new FormData(form).entries());
    const status = form.querySelector(".form-status");

    if (!formData.orderNumber?.trim() || !formData.phone?.trim()) {
      status.textContent = "Please enter your order number and phone number.";
      return;
    }

    currentOrderNumber = formData.orderNumber.trim();

    if (!isBackendReady()) {
      status.textContent = backendSetupMessage();
      return;
    }

    try {
      status.textContent = "Checking order status...";
      const order = await getRestaurantOrderStatus(formData.orderNumber, formData.phone);
      if (!order) {
        render("No matching order found. Please check the order number and phone number.");
        return;
      }
      render("", order);
    } catch (error) {
      status.textContent = error.message || "Could not check this order status.";
    }
  });
}

render();
