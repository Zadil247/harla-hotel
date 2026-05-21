import { Footer, Navbar } from "./components.js?v=20260519-client-feedback";
import {
  deliveryPastryItems,
  images,
  restaurantAddressAreas,
  restaurantMenuItems,
  restaurantPaymentMethods,
  siteConfig,
  whatsappLinks,
} from "./data.js?v=20260519-client-feedback";
import {
  backendSetupMessage,
  createRestaurantOrder,
  isBackendReady,
  uploadPaymentScreenshot,
} from "./supabase-api.js?v=20260513-restaurant-order";

const app = document.querySelector("#restaurant-order-app");
const orderTypes = [
  {
    value: "dine_in",
    label: "Dine In",
    text: "Eat at Harla Restaurant and optionally request the VIP room.",
  },
  {
    value: "take_away",
    label: "Take Away",
    text: "Order ahead and pick up from Harla Hotel after online payment.",
  },
  {
    value: "delivery",
    label: "Delivery",
    text: "Send food and delivery-only pastries to your Harar address.",
  },
];

const initialOrderType = new URLSearchParams(window.location.search).get("order");
const normalizedInitialOrderType = initialOrderType === "takeaway" ? "take_away" : initialOrderType;
const initialOrder = orderTypes.some((type) => type.value === normalizedInitialOrderType)
  ? normalizedInitialOrderType
  : "dine_in";

const state = {
  step: "menu",
  orderType: initialOrder,
  quantities: Object.fromEntries(restaurantMenuItems.map((item) => [item.id, 0])),
  pastries: Object.fromEntries(
    deliveryPastryItems.map((item) => [item.id, { kilograms: 0, level: "Level 1" }]),
  ),
  paymentChoice: initialOrder && initialOrder !== "dine_in" ? "online" : "cash_at_hotel",
};

function formatEtb(amount) {
  return `${new Intl.NumberFormat("en-US").format(amount)} ETB`;
}

function orderTypeLabel(value = state.orderType) {
  return orderTypes.find((type) => type.value === value)?.label || "";
}

function vipRoomWhatsAppUrl() {
  const message =
    "Hello Harla Hotel, I would like to request the VIP restaurant room. Please send me availability and details.";
  return `https://wa.me/REPLACE_WITH_HOTEL_WHATSAPP_NUMBER?text=${encodeURIComponent(message)}`;
}

function paymentMethodLabel(value) {
  return restaurantPaymentMethods.find((method) => method.value === value)?.label || value;
}

function selectedItems() {
  return restaurantMenuItems
    .map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      price: item.price,
      quantity: state.quantities[item.id] || 0,
      line_total: (state.quantities[item.id] || 0) * item.price,
    }))
    .filter((item) => item.quantity > 0);
}

function selectedPastries() {
  if (state.orderType !== "delivery") {
    return [];
  }

  return deliveryPastryItems
    .map((item) => ({
      id: item.id,
      name: item.name,
      kilograms: Number(state.pastries[item.id]?.kilograms || 0),
      level: state.pastries[item.id]?.level || "Level 1",
    }))
    .filter((item) => item.kilograms > 0);
}

function estimatedTotal() {
  return selectedItems().reduce((total, item) => total + item.line_total, 0);
}

function groupedMenu() {
  return restaurantMenuItems.reduce((groups, item) => {
    groups[item.category] ||= [];
    groups[item.category].push(item);
    return groups;
  }, {});
}

function orderSteps() {
  const steps = [
    ["menu", "Menu"],
    ["details", "Details & Payment"],
  ];

  return `
    <div class="order-steps" aria-label="Restaurant order steps">
      ${steps
        .map(
          ([key, label], index) => `
            <span class="${state.step === key ? "is-active" : ""}">
              <strong>${index + 1}</strong>${label}
            </span>
          `,
        )
        .join("")}
    </div>
  `;
}

function menuItemCard(item) {
  const quantity = state.quantities[item.id] || 0;

  return `
    <article class="menu-item-card">
      <div>
        <p class="card-kicker">${item.category}</p>
        <h3>${item.name}</h3>
        <p>${item.description}</p>
      </div>
      <div class="menu-item-footer">
        <strong>${formatEtb(item.price)}</strong>
        <div class="quantity-control" aria-label="${item.name} quantity">
          <button type="button" data-quantity="${item.id}" data-direction="-1">-</button>
          <span>${quantity}</span>
          <button type="button" data-quantity="${item.id}" data-direction="1">+</button>
        </div>
      </div>
    </article>
  `;
}

function pastryCard(item) {
  const pastry = state.pastries[item.id];

  return `
    <article class="menu-item-card pastry-card">
      <div>
        <p class="card-kicker">Delivery pastry</p>
        <h3>${item.name}</h3>
        <p>${item.name === "Cookies" ? "Cookies must be ordered in kilograms." : "Choose kilograms and pastry level."}</p>
      </div>
      <div class="pastry-controls">
        <label>
          Kilograms
          <input type="number" min="0" step="0.5" value="${pastry.kilograms}" data-pastry-kg="${item.id}" />
        </label>
        <label>
          Level
          <select data-pastry-level="${item.id}">
            ${["Level 1", "Level 2", "Level 3"]
              .map((level) => `<option ${pastry.level === level ? "selected" : ""}>${level}</option>`)
              .join("")}
          </select>
        </label>
      </div>
    </article>
  `;
}

function orderSummary() {
  const items = selectedItems();
  const pastries = selectedPastries();

  return `
    <aside class="order-summary">
      <p class="eyebrow">${orderTypeLabel()}</p>
      <h3>Current Order</h3>
      ${
        items.length
          ? `<ul>${items.map((item) => `<li>${item.quantity} x ${item.name} <strong>${formatEtb(item.line_total)}</strong></li>`).join("")}</ul>`
          : "<p>No food or drink items selected yet.</p>"
      }
      ${
        pastries.length
          ? `<div class="pastry-summary"><strong>Delivery pastries</strong><ul>${pastries
              .map((item) => `<li>${item.name}: ${item.kilograms} kg, ${item.level}</li>`)
              .join("")}</ul></div>`
          : ""
      }
      <div class="summary-total">
        <span>Food & drink total</span>
        <strong>${formatEtb(estimatedTotal())}</strong>
      </div>
      <small>Pastry pricing is confirmed by Harla Hotel after the order request.</small>
    </aside>
  `;
}

function renderMenuStep(message = "") {
  const groups = groupedMenu();

  return `
    ${orderSteps()}
    <section class="order-workspace">
      <div class="order-main">
        <div class="section-heading">
          <p class="eyebrow">${orderTypeLabel()} Order</p>
          <h2>Choose food and drinks</h2>
          <p>Add menu items and quantities. Delivery customers can also add pastries by kilogram.</p>
        </div>
        ${
          state.orderType === "dine_in"
            ? `<a class="btn btn-whatsapp vip-whatsapp-button" href="${vipRoomWhatsAppUrl()}" target="_blank" rel="noopener">Request VIP Room on WhatsApp</a>`
            : ""
        }
        ${Object.entries(groups)
          .map(
            ([category, items]) => `
              <section class="menu-category" aria-labelledby="category-${category.toLowerCase()}">
                <h3 id="category-${category.toLowerCase()}">${category}</h3>
                <div class="menu-grid">${items.map(menuItemCard).join("")}</div>
              </section>
            `,
          )
          .join("")}
        ${
          state.orderType === "delivery"
            ? `
              <section class="menu-category pastry-section" aria-labelledby="pastry-title">
                <h3 id="pastry-title">Delivery Pastries</h3>
                <p>Cake, cookies, pastries, and cupcakes are available for delivery orders only.</p>
                <div class="menu-grid">${deliveryPastryItems.map(pastryCard).join("")}</div>
              </section>
            `
            : ""
        }
        <div class="order-actions">
          <a class="btn btn-light" href="./index.html#restaurant-order-options">Change Order Type</a>
          <button class="btn btn-primary" type="button" data-confirm-menu>Confirm Order</button>
        </div>
        <p class="form-status" role="status" aria-live="polite">${message}</p>
      </div>
      ${orderSummary()}
    </section>
  `;
}

function paymentFields() {
  const onlineRequired = state.orderType !== "dine_in";

  return `
    <div class="payment-section">
      <h3>Payment</h3>
      ${
        state.orderType === "dine_in"
          ? `
            <div class="payment-options">
              <label><input type="radio" name="paymentChoice" value="online" ${state.paymentChoice === "online" ? "checked" : ""} /> Pay Online Now</label>
              <label><input type="radio" name="paymentChoice" value="cash_at_hotel" ${state.paymentChoice === "cash_at_hotel" ? "checked" : ""} /> Pay Cash at Hotel</label>
            </div>
          `
          : `<p class="payment-note">${orderTypeLabel()} orders require online payment before submission.</p>`
      }
      <div data-online-payment ${!onlineRequired && state.paymentChoice !== "online" ? "hidden" : ""}>
        <label>
          Payment method
          <select name="paymentMethod" id="payment-method">
            ${restaurantPaymentMethods
              .map((method) => `<option value="${method.value}">${method.label}</option>`)
              .join("")}
          </select>
        </label>
        <div class="payment-instructions" data-payment-instructions>
          ${restaurantPaymentMethods[0].instructions}
        </div>
        <label>
          Payment reference / transaction ID
          <input name="paymentReference" type="text" placeholder="Paste CBE, Telebirr, or M-Pesa transaction ID" />
        </label>
        <label>
          Payment screenshot
          <input name="paymentScreenshot" type="file" accept="image/*" />
        </label>
      </div>
    </div>
  `;
}

function renderDetailsStep(message = "") {
  const needsDeliveryAddress = state.orderType === "delivery";

  return `
    ${orderSteps()}
    <section class="order-workspace">
      <form class="booking-form order-details-form" id="restaurant-order-form">
        <div class="section-heading">
          <p class="eyebrow">${orderTypeLabel()} Details</p>
          <h2>Customer details and payment</h2>
          <p>Orders are submitted to Harla Hotel after details and payment requirements are complete.</p>
        </div>
        <div class="form-grid">
          <label>
            Customer name
            <input name="customerName" type="text" autocomplete="name" required />
          </label>
          <label>
            Phone number
            <input name="phone" type="tel" autocomplete="tel" required />
          </label>
          ${
            needsDeliveryAddress
              ? `
                <label>
                  Address area
                  <select name="addressArea" id="address-area" required>
                    <option value="">Select address area</option>
                    ${restaurantAddressAreas.map((area) => `<option>${area}</option>`).join("")}
                  </select>
                </label>
                <label data-custom-address hidden>
                  Custom address
                  <input name="customAddress" type="text" placeholder="Write your address" />
                </label>
              `
              : ""
          }
        </div>
        ${paymentFields()}
        <div class="order-actions">
          <button class="btn btn-light" type="button" data-back-to-menu>Back to Menu</button>
          <button class="btn btn-primary" type="submit">Submit Order</button>
        </div>
        <p class="form-status" role="status" aria-live="polite">${message}</p>
      </form>
      ${orderSummary()}
    </section>
  `;
}

function renderSuccess() {
  return `
    ${orderSteps()}
    <section class="order-panel success-card">
      <p class="eyebrow">Order Submitted</p>
      <h2>Thank you. Harla Hotel received your order.</h2>
      <p>Your order is pending review. If payment was submitted online, the team will verify the transaction.</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="./restaurant-order.html">Start Another Order</a>
        <a class="btn btn-whatsapp" href="${whatsappLinks.table}">Contact on WhatsApp</a>
      </div>
    </section>
  `;
}

function render(message = "") {
  const content =
    state.step === "menu"
      ? renderMenuStep(message)
      : state.step === "success"
        ? renderSuccess()
        : renderDetailsStep(message);

  app.innerHTML = `
    ${Navbar("restaurant")}
    <main id="restaurant-order-main" class="restaurant-order-shell">
      <section class="restaurant-order-hero" style="--page-hero-image: url('${images.restaurant}')">
        <div class="page-hero-content reveal is-visible">
          <p class="eyebrow">Harla Restaurant</p>
          <h1>Restaurant Menu</h1>
          <p>${orderTypeLabel()} is selected. Choose your meals, quantities, and continue to details.</p>
        </div>
      </section>
      <div class="order-container">${content}</div>
    </main>
    ${Footer()}
  `;

  document.querySelector("[data-header]")?.classList.add("is-scrolled");
  bindEvents();
}

function bindNav() {
  const navToggle = document.querySelector("[data-nav-toggle]");
  const navMenu = document.querySelector("[data-nav-menu]");

  navToggle?.addEventListener("click", () => {
    const expanded = navToggle.getAttribute("aria-expanded") === "true";
    navToggle.setAttribute("aria-expanded", String(!expanded));
    navMenu.classList.toggle("is-open");
  });
}

function bindEvents() {
  bindNav();

  document.querySelector("[data-back-to-menu]")?.addEventListener("click", () => {
    state.step = "menu";
    render();
  });

  document.querySelector("[data-confirm-menu]")?.addEventListener("click", () => {
    if (!selectedItems().length && !selectedPastries().length) {
      render("Please select at least one menu item before confirming.");
      return;
    }
    state.step = "details";
    render();
  });

  document.querySelectorAll("[data-quantity]").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = button.dataset.quantity;
      const direction = Number(button.dataset.direction);
      state.quantities[itemId] = Math.max(0, (state.quantities[itemId] || 0) + direction);
      render();
    });
  });

  document.querySelectorAll("[data-pastry-kg]").forEach((input) => {
    input.addEventListener("input", () => {
      state.pastries[input.dataset.pastryKg].kilograms = Math.max(0, Number(input.value || 0));
    });
  });

  document.querySelectorAll("[data-pastry-level]").forEach((select) => {
    select.addEventListener("change", () => {
      state.pastries[select.dataset.pastryLevel].level = select.value;
    });
  });

  document.querySelectorAll("input[name='paymentChoice']").forEach((input) => {
    input.addEventListener("change", () => {
      state.paymentChoice = input.value;
      render();
    });
  });

  const addressArea = document.querySelector("#address-area");
  const customAddress = document.querySelector("[data-custom-address]");
  addressArea?.addEventListener("change", () => {
    customAddress.hidden = addressArea.value !== "Other";
  });

  const paymentMethod = document.querySelector("#payment-method");
  const instructions = document.querySelector("[data-payment-instructions]");
  paymentMethod?.addEventListener("change", () => {
    const method = restaurantPaymentMethods.find((item) => item.value === paymentMethod.value);
    instructions.textContent = method?.instructions || "";
  });

  document.querySelector("#restaurant-order-form")?.addEventListener("submit", submitOrder);
}

async function submitOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = form.querySelector(".form-status");
  const rawFormData = new FormData(form);
  const formData = Object.fromEntries(rawFormData.entries());
  const paymentScreenshot = rawFormData.get("paymentScreenshot");
  const onlinePaymentRequired = state.orderType !== "dine_in" || state.paymentChoice === "online";

  if (!formData.customerName?.trim() || !formData.phone?.trim()) {
    status.textContent = "Please enter customer name and phone number.";
    return;
  }

  if (state.orderType === "delivery" && !formData.addressArea) {
    status.textContent = "Please select the delivery address area.";
    return;
  }

  if (state.orderType === "delivery" && formData.addressArea === "Other" && !formData.customAddress?.trim()) {
    status.textContent = "Please write the custom address.";
    return;
  }

  if (onlinePaymentRequired && (!formData.paymentMethod || !formData.paymentReference?.trim())) {
    status.textContent = "Please choose payment method and enter the transaction reference.";
    return;
  }

  if (
    onlinePaymentRequired &&
    (!(paymentScreenshot instanceof File) || !paymentScreenshot.name)
  ) {
    status.textContent = "Please upload the payment screenshot image.";
    return;
  }

  const orderPayload = {
    customerName: formData.customerName,
    phone: formData.phone,
    orderType: orderTypeLabel(),
    addressArea: state.orderType === "delivery" ? formData.addressArea : "Not required",
    customAddress: state.orderType === "delivery" ? formData.customAddress : "",
    items: selectedItems(),
    pastryItems: selectedPastries(),
    paymentMethod: onlinePaymentRequired ? paymentMethodLabel(formData.paymentMethod) : "cash_at_hotel",
    paymentReference: onlinePaymentRequired ? formData.paymentReference : "",
    paymentStatus: onlinePaymentRequired ? "submitted_for_verification" : "pay_at_hotel",
    paymentScreenshotUrl: "",
  };

  if (!isBackendReady()) {
    console.info("Harla Hotel restaurant order", {
      endpoint: siteConfig.bookingEndpoint,
      orderPayload: {
        ...orderPayload,
        paymentScreenshot: paymentScreenshot?.name || "",
      },
    });
    status.textContent = backendSetupMessage();
    return;
  }

  try {
    status.textContent = "Submitting order...";
    if (onlinePaymentRequired) {
      orderPayload.paymentScreenshotUrl = await uploadPaymentScreenshot(paymentScreenshot);
    }
    await createRestaurantOrder(orderPayload);
    state.step = "success";
    render();
  } catch (error) {
    status.textContent = error.message || "Sorry, we could not submit your order. Please try WhatsApp.";
  }
}

render();
