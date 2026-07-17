import { Footer, Navbar } from "./components.js?v=20260702-booking-availability";
import { images, roomBookingTypes, siteConfig } from "./data.js?v=20260702-booking-availability";
import { initImageLightbox, LightboxImage, LightboxMarkup } from "./lightbox.js?v=20260702-booking-availability";
import {
  backendSetupMessage,
  createRoomBooking,
  getRoomInventory,
  isBackendReady,
  subscribeRoomInventory,
  uploadPaymentScreenshot,
} from "./supabase-api.js?v=20260702-booking-availability";

const app = document.querySelector("#room-booking-app");
const roomSlugAliases = {
  "double-bed-room": "twin-bed-room",
  "queen-normal-room": "queen-size-bed-room",
  "queen-standard-room": "queen-size-bed-room",
  "cultural-king-room": "vip-room",
  "harari-cultural-room": "vip-room",
};
const requestedRoomSlug = new URLSearchParams(window.location.search).get("room");
const initialRoomSlug = roomSlugAliases[requestedRoomSlug] || requestedRoomSlug || "";
const localPaymentMethods = new Set(["CBE", "Telebirr", "E-Birr"]);

let inventoryByType = new Map(
  roomBookingTypes.map((room) => [
    room.name,
    {
      room_type: room.name,
      total_rooms: room.totalRooms,
      available_rooms: room.availableRooms,
    },
  ]),
);
let scrollHandlerBound = false;

const state = {
  step: "select",
  selectedRoomSlug: roomBookingTypes.some((room) => room.slug === initialRoomSlug) ? initialRoomSlug : "",
  details: {},
  payment: {
    paymentMethod: "",
    paymentReference: "",
  },
  success: null,
  message: "",
  isSubmitting: false,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatEtb(amount) {
  return `${new Intl.NumberFormat("en-US").format(Number(amount || 0))} ETB`;
}

function todayIso() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function addDaysIso(dateValue, days) {
  const date = new Date(`${dateValue || todayIso()}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function roomWithInventory(room) {
  const inventory = inventoryByType.get(room.name);
  return {
    ...room,
    totalRooms: Number(inventory?.total_rooms ?? room.totalRooms),
    availableRooms: Number(inventory?.available_rooms ?? room.availableRooms),
  };
}

function selectedRoomBase() {
  return roomBookingTypes.find((room) => room.slug === state.selectedRoomSlug) || null;
}

function selectedRoom() {
  const room = selectedRoomBase();
  return room ? roomWithInventory(room) : null;
}

function totalRooms() {
  return Array.from(inventoryByType.values()).reduce(
    (total, room) => total + Number(room.total_rooms || 0),
    0,
  );
}

function calculateNights(checkIn = state.details.checkIn, checkOut = state.details.checkOut) {
  if (!checkIn || !checkOut) {
    return 0;
  }

  const start = new Date(`${checkIn}T00:00:00`);
  const end = new Date(`${checkOut}T00:00:00`);
  const nights = Math.round((end - start) / 86_400_000);
  return nights > 0 ? nights : 0;
}

function currentTotal() {
  const room = selectedRoom();
  return room ? calculateNights() * room.pricePerNight : 0;
}

function paymentInstructions(method) {
  const total = currentTotal();
  const amount = total ? `Total due: ${formatEtb(total)}.` : "";
  const messages = {
    "Visa/Mastercard":
      "International card payment is coming soon. For now, submit this request and Harla Hotel will contact you with card payment support.",
    CBE: `CBE: 1000703782756 - Harla Hotel. ${amount}`,
    Telebirr: `Telebirr: 0915321828 - Rekib. ${amount}`,
    "E-Birr": `E-Birr: 0915321188. ${amount}`,
  };

  return messages[method] || "Choose a payment method to see instructions.";
}

function stepNumber(step) {
  return ["select", "details", "confirm", "payment"].indexOf(step) + 1;
}

function stepper() {
  const steps = [
    ["select", "Select Room"],
    ["details", "Guest Details"],
    ["confirm", "Confirm Price"],
    ["payment", "Payment"],
  ];
  const activeIndex = stepNumber(state.step);

  return `
    <ol class="booking-stepper" aria-label="Room booking steps">
      ${steps
        .map(([key, label], index) => {
          const number = index + 1;
          const statusClass =
            key === state.step ? "is-active" : number < activeIndex ? "is-complete" : "";
          return `
            <li class="${statusClass}">
              <span>${number}</span>
              <strong>${label}</strong>
            </li>
          `;
        })
        .join("")}
    </ol>
  `;
}

function availabilityPercent(room) {
  if (!room.totalRooms) {
    return 0;
  }
  return Math.max(0, Math.min(100, (room.availableRooms / room.totalRooms) * 100));
}

function availabilityDisplay(room) {
  const percent = Math.round(availabilityPercent(room));
  return percent > 0 ? `Availability: ${percent}%` : "Booking unavailable. Please contact us.";
}

function roomCard(room) {
  const liveRoom = roomWithInventory(room);
  const isAvailable = liveRoom.availableRooms > 0;
  const isSelected = state.selectedRoomSlug === room.slug;

  return `
    <article class="premium-room-card ${isSelected ? "is-selected" : ""} ${!isAvailable ? "is-unavailable" : ""}" data-room-card="${room.slug}" data-room-type="${room.name}">
      <div class="premium-room-media">
        ${LightboxImage(room.image, room.name, "room-type-lightbox-image")}
        <span class="room-price-badge">${room.priceLabel}</span>
      </div>
      <div class="premium-room-body">
        <div class="premium-room-heading">
          <div>
            <p class="card-kicker">${isAvailable ? "Available now" : "Fully booked"}</p>
            <h3>${room.name}</h3>
          </div>
          <strong>${formatEtb(room.pricePerNight)}</strong>
        </div>
        <p>${room.description}</p>
        <ul class="amenities premium-amenities">
          ${room.features.map((feature) => `<li>${feature}</li>`).join("")}
        </ul>
        <div class="premium-availability">
          <div>
            <span>Live room status</span>
            <strong data-room-card-available>${availabilityDisplay(liveRoom)}</strong>
          </div>
          <div class="premium-availability-bar" aria-hidden="true">
            <span data-room-card-fill style="width: ${availabilityPercent(liveRoom)}%"></span>
          </div>
        </div>
        ${
          isAvailable
            ? `<button class="btn btn-primary" type="button" data-select-room="${room.slug}">Book This Room</button>`
            : `
              <div class="room-unavailable-note">
                <strong>Booking unavailable. Please contact us.</strong>
                <a href="mailto:${siteConfig.email}">${siteConfig.email}</a>
                <a href="tel:${siteConfig.phone.replace(/\s/g, "")}">${siteConfig.phone}</a>
              </div>
              <button class="btn btn-primary" type="button" disabled>Unavailable</button>
            `
        }
      </div>
    </article>
  `;
}

function selectionStep() {
  return `
    <section class="booking-step-panel" aria-labelledby="room-select-title">
      <div class="booking-panel-heading">
        <p class="eyebrow">Step 1</p>
        <h2 id="room-select-title">Choose your room</h2>
        <p>Select from Harla Hotel's live room inventory. Rooms with no availability cannot be booked online.</p>
      </div>
      <div class="premium-room-grid">
        ${roomBookingTypes.map(roomCard).join("")}
      </div>
      <p class="availability-status" data-room-booking-inventory-status role="status" aria-live="polite"></p>
    </section>
  `;
}

function selectedRoomPanel() {
  const room = selectedRoom();

  if (!room) {
    return "";
  }

  return `
    <aside class="selected-room-panel">
      <p class="eyebrow">Selected Room</p>
      <h3>${room.name}</h3>
      <p>${room.priceLabel}</p>
      <dl>
        <div><dt>Live availability</dt><dd>${availabilityDisplay(room)}</dd></div>
        <div><dt>Included</dt><dd>${room.features.join(", ")}</dd></div>
      </dl>
      <button class="text-link" type="button" data-change-room>Change room</button>
    </aside>
  `;
}

function detailsStep() {
  const room = selectedRoom();
  const minCheckIn = todayIso();
  const minCheckOut = addDaysIso(state.details.checkIn || minCheckIn, 1);

  return `
    <section class="booking-step-panel booking-details-layout" aria-labelledby="guest-details-title">
      <div class="booking-panel-heading">
        <p class="eyebrow">Step 2</p>
        <h2 id="guest-details-title">Guest details</h2>
        <p>Your room is selected and locked for this form. Availability will be checked again before confirmation.</p>
      </div>
      <div class="booking-details-grid">
        ${selectedRoomPanel()}
        <form class="booking-form premium-booking-form" id="guest-details-form">
          <input name="roomType" type="hidden" value="${escapeHtml(room?.slug || "")}" />
          <div class="locked-room-field">
            <span>Room type</span>
            <strong>${escapeHtml(room?.name || "Choose a room")}</strong>
          </div>
          <div class="form-grid">
            <label>
              Full name
              <input name="fullName" type="text" autocomplete="name" value="${escapeHtml(state.details.fullName || "")}" required />
            </label>
            <label>
              Email address
              <input name="email" type="email" autocomplete="email" value="${escapeHtml(state.details.email || "")}" required />
            </label>
            <label>
              Phone number
              <input name="phone" type="tel" autocomplete="tel" value="${escapeHtml(state.details.phone || "")}" required />
            </label>
            <label>
              Date of birth
              <input name="dateOfBirth" type="date" max="${escapeHtml(todayIso())}" value="${escapeHtml(state.details.dateOfBirth || "")}" required />
            </label>
            <label>
              Nationality
              <input name="nationality" type="text" autocomplete="country-name" value="${escapeHtml(state.details.nationality || "")}" required />
            </label>
            <label>
              Check-in date
              <input name="checkIn" id="room-check-in" type="date" min="${escapeHtml(minCheckIn)}" value="${escapeHtml(state.details.checkIn || "")}" required />
            </label>
            <label>
              Check-out date
              <input name="checkOut" id="room-check-out" type="date" min="${escapeHtml(minCheckOut)}" value="${escapeHtml(state.details.checkOut || "")}" required />
            </label>
            <label>
              Number of guests
              <input name="guests" type="number" min="1" value="${escapeHtml(state.details.guests || "1")}" required />
            </label>
            <label class="form-wide">
              Special requests/message <span class="optional-field">Optional</span>
              <textarea name="message" rows="4" placeholder="Arrival time, stay requests, or room preferences...">${escapeHtml(state.details.message || "")}</textarea>
            </label>
          </div>
          <div class="id-upload-placeholder form-wide">
            <strong>Government ID upload will be added in Phase 2.</strong>
            <span>Required setup: private Supabase Storage bucket for guest IDs and dedicated booking columns for secure file references.</span>
          </div>
          <div class="room-booking-actions">
            <button class="btn btn-light" type="button" data-back-to-select>Back to Rooms</button>
            <button class="btn btn-primary" type="submit">Continue to Price Confirmation</button>
          </div>
          <p class="form-status" role="status" aria-live="polite"></p>
        </form>
      </div>
    </section>
  `;
}

function summaryRows() {
  const room = selectedRoom();
  const nights = calculateNights();
  const total = currentTotal();

  return `
    <dl class="booking-summary-list">
      <div><dt>Room type</dt><dd>${escapeHtml(room?.name || "-")}</dd></div>
      <div><dt>Price per night</dt><dd>${room ? formatEtb(room.pricePerNight) : "-"}</dd></div>
      <div><dt>Number of nights</dt><dd>${nights || "-"}</dd></div>
      <div><dt>Check-in date</dt><dd>${escapeHtml(state.details.checkIn || "-")}</dd></div>
      <div><dt>Check-out date</dt><dd>${escapeHtml(state.details.checkOut || "-")}</dd></div>
      <div><dt>Number of guests</dt><dd>${escapeHtml(state.details.guests || "-")}</dd></div>
      <div><dt>Customer name</dt><dd>${escapeHtml(state.details.fullName || "-")}</dd></div>
      <div class="booking-summary-total"><dt>Total price</dt><dd>${formatEtb(total)}</dd></div>
    </dl>
  `;
}

function confirmationStep() {
  return `
    <section class="booking-step-panel" aria-labelledby="price-confirm-title">
      <div class="booking-panel-heading">
        <p class="eyebrow">Step 3</p>
        <h2 id="price-confirm-title">Confirm your stay price</h2>
        <p>Review your room, dates, guest count, and total before moving to payment.</p>
      </div>
      <div class="price-confirm-card">
        ${summaryRows()}
        <div class="room-booking-actions">
          <button class="btn btn-light" type="button" data-back-to-details>Back to Details</button>
          <button class="btn btn-primary" type="button" data-confirm-price>Confirm and Continue to Payment</button>
        </div>
        <p class="form-status" role="status" aria-live="polite"></p>
      </div>
    </section>
  `;
}

function paymentStep() {
  const room = selectedRoom();
  const method = state.payment.paymentMethod || "";
  const isLocalPayment = localPaymentMethods.has(method);

  return `
    <section class="booking-step-panel booking-payment-layout" aria-labelledby="payment-title">
      <div class="booking-panel-heading">
        <p class="eyebrow">Step 4</p>
        <h2 id="payment-title">Payment details</h2>
        <p>Local payment bookings are submitted for Harla Hotel admin review before confirmation.</p>
      </div>
      <div class="booking-details-grid">
        <aside class="selected-room-panel payment-summary-panel">
          <p class="eyebrow">Booking Summary</p>
          <h3>${escapeHtml(room?.name || "-")}</h3>
          ${summaryRows()}
        </aside>
        <form class="booking-form premium-booking-form" id="payment-form">
          <div class="form-grid">
            <label class="form-wide">
              Payment method
              <select name="paymentMethod" id="room-payment-method" required>
                <option value="">Choose payment method</option>
                <option ${method === "CBE" ? "selected" : ""}>CBE</option>
                <option ${method === "Telebirr" ? "selected" : ""}>Telebirr</option>
                <option ${method === "E-Birr" ? "selected" : ""}>E-Birr</option>
                <option ${method === "Visa/Mastercard" ? "selected" : ""}>Visa/Mastercard</option>
              </select>
            </label>
            <div class="payment-instructions room-payment-instructions form-wide" data-payment-instructions>
              ${escapeHtml(paymentInstructions(method))}
            </div>
            <label>
              Payment reference number ${isLocalPayment ? "" : '<span class="optional-field">Optional</span>'}
              <input name="paymentReference" type="text" value="${escapeHtml(state.payment.paymentReference || "")}" placeholder="Transaction/reference ID" ${isLocalPayment ? "required" : ""} />
            </label>
            <label>
              Payment screenshot/proof ${isLocalPayment ? "" : '<span class="optional-field">Optional</span>'}
              <input name="paymentScreenshot" type="file" accept="image/jpeg,image/png,image/webp" ${isLocalPayment ? "required" : ""} />
            </label>
          </div>
          <div class="payment-review-note">
            ${
              isLocalPayment
                ? "Your booking will be submitted as Pending Payment Review. Harla Hotel will confirm it after checking your payment proof."
                : "Card payment is not connected yet. This request will be saved as pending card payment support."
            }
          </div>
          <div class="room-booking-actions">
            <button class="btn btn-light" type="button" data-back-to-confirm>Back to Confirmation</button>
            <button class="btn btn-primary" type="submit" ${state.isSubmitting ? "disabled" : ""}>
              ${state.isSubmitting ? "Submitting..." : "Submit Booking Request"}
            </button>
          </div>
          <p class="form-status" role="status" aria-live="polite"></p>
        </form>
      </div>
    </section>
  `;
}

function successStep() {
  return `
    <section class="booking-step-panel booking-success-panel" aria-labelledby="booking-success-title">
      <p class="eyebrow">Booking Submitted</p>
      <h2 id="booking-success-title">Thank you. Your booking request is pending payment review.</h2>
      <p>Harla Hotel will review your request and payment proof from the admin dashboard.</p>
      <dl class="booking-summary-list">
        <div><dt>Booking reference</dt><dd>${escapeHtml(state.success?.bookingNumber || "-")}</dd></div>
        <div><dt>Room type</dt><dd>${escapeHtml(state.success?.roomName || "-")}</dd></div>
        <div><dt>Total amount</dt><dd>${escapeHtml(state.success?.total || "-")}</dd></div>
        <div><dt>Payment method</dt><dd>${escapeHtml(state.success?.paymentMethod || "-")}</dd></div>
        <div><dt>Status</dt><dd>Pending Payment Review</dd></div>
      </dl>
      <div class="room-booking-actions">
        <a class="btn btn-primary" href="./booking-status.html?booking=${encodeURIComponent(state.success?.bookingNumber || "")}">Check Booking Status</a>
        <a class="btn btn-whatsapp" href="${buildWhatsAppHref(selectedRoom(), calculateNights(), currentTotal())}">Contact on WhatsApp</a>
      </div>
    </section>
  `;
}

function activeStepMarkup() {
  if (state.step === "details") {
    return detailsStep();
  }
  if (state.step === "confirm") {
    return confirmationStep();
  }
  if (state.step === "payment") {
    return paymentStep();
  }
  if (state.step === "success") {
    return successStep();
  }
  return selectionStep();
}

function buildWhatsAppHref(room, nights, total) {
  const message = [
    "Hello Harla Hotel, I want to confirm a room booking.",
    room?.name ? `Room type: ${room.name}` : "",
    state.details.checkIn ? `Check-in: ${state.details.checkIn}` : "",
    state.details.checkOut ? `Check-out: ${state.details.checkOut}` : "",
    nights ? `Nights: ${nights}` : "",
    total ? `Estimated total: ${formatEtb(total)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `https://wa.me/${siteConfig.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

function bookingMessage(details) {
  return [
    "Guest profile collected during Phase 1 booking flow:",
    `Date of birth: ${details.dateOfBirth}`,
    `Nationality: ${details.nationality}`,
    details.message ? `Special requests: ${details.message}` : "",
    "Government ID upload pending Phase 2 database/storage setup.",
  ]
    .filter(Boolean)
    .join("\n");
}

function render() {
  const selected = selectedRoom();

  app.innerHTML = `
    ${Navbar("rooms")}
    <main id="room-booking-main">
      <section class="room-booking-hero premium-booking-hero" style="--page-hero-image: url('${images.hero}')">
        <div class="room-booking-hero-copy reveal is-visible">
          <p class="eyebrow">Professional Room Booking</p>
          <h1>Book Your Stay at Harla Hotel</h1>
          <p>
            Select a live room type, enter guest details, confirm the ETB total, and submit payment proof for review.
          </p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="#room-booking-flow">Start Booking</a>
            <a class="btn btn-outline" href="./booking-status.html">Check Booking Status</a>
          </div>
        </div>
        <div class="room-total-card reveal is-visible">
          <strong data-total-rooms>Live</strong>
          <span>Room status updates from Harla Hotel inventory</span>
        </div>
      </section>

      <section class="section booking-flow-section" id="room-booking-flow" aria-label="Room booking flow">
        <div class="booking-flow-shell">
          ${stepper()}
          ${
            selected && state.step !== "select" && state.step !== "success"
              ? `<div class="selected-room-ribbon">
                  <span>${selected.name}</span>
                  <strong>${selected.priceLabel}</strong>
                  <small>${availabilityDisplay(selected)}</small>
                </div>`
              : ""
          }
          ${state.message ? `<p class="booking-flow-message" role="status">${escapeHtml(state.message)}</p>` : ""}
          ${activeStepMarkup()}
        </div>
      </section>
    </main>
    ${LightboxMarkup("Harla Hotel room booking image viewer")}
    ${Footer()}
  `;

  bindPageEvents();
  initImageLightbox();
}

function setHeaderState() {
  document.querySelector("[data-header]")?.classList.toggle("is-scrolled", window.scrollY > 20);
}

function closeMenu() {
  const navToggle = document.querySelector("[data-nav-toggle]");
  const navMenu = document.querySelector("[data-nav-menu]");
  navToggle?.setAttribute("aria-expanded", "false");
  navMenu?.classList.remove("is-open");
}

function scrollToFlow() {
  document.querySelector("#room-booking-flow")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function selectedAvailable() {
  const room = selectedRoom();
  return Boolean(room && room.availableRooms > 0);
}

async function refreshInventory() {
  if (!isBackendReady()) {
    state.message = backendSetupMessage();
    return [];
  }

  const inventory = await getRoomInventory();
  renderInventory(inventory, false);
  return inventory;
}

function renderInventory(inventory, shouldRender = true) {
  if (!inventory.length) {
    state.message = "No room inventory records found in Supabase yet.";
    if (shouldRender) {
      render();
    }
    return;
  }

  inventoryByType = new Map(
    inventory.map((room) => [
      room.room_type,
      {
        room_type: room.room_type,
        total_rooms: Number(room.total_rooms || 0),
        available_rooms: Number(room.available_rooms || 0),
        updated_at: room.updated_at,
      },
    ]),
  );

  if (selectedRoomBase() && !selectedAvailable() && state.step !== "select") {
    state.step = "select";
    state.message = "That room is no longer available. Please choose another room type or contact Harla Hotel.";
  }

  if (shouldRender) {
    render();
  }
}

async function loadInventory() {
  if (!isBackendReady()) {
    state.message = backendSetupMessage();
    render();
    return;
  }

  try {
    renderInventory(await getRoomInventory());
  } catch (error) {
    state.message = error.message || "Could not load room availability.";
    render();
  }
}

function selectRoom(slug) {
  const room = roomBookingTypes.find((item) => item.slug === slug);
  if (!room) {
    return;
  }

  const liveRoom = roomWithInventory(room);
  if (liveRoom.availableRooms < 1) {
    state.message = `${liveRoom.name} is currently unavailable. Please contact ${siteConfig.phone} or ${siteConfig.email}.`;
    render();
    return;
  }

  state.selectedRoomSlug = slug;
  state.step = "details";
  state.message = "";
  render();
  scrollToFlow();
}

function validateDetails(details) {
  const requiredFields = [
    ["fullName", "Full name"],
    ["email", "Email address"],
    ["phone", "Phone number"],
    ["dateOfBirth", "Date of birth"],
    ["nationality", "Nationality"],
    ["checkIn", "Check-in date"],
    ["checkOut", "Check-out date"],
    ["guests", "Number of guests"],
  ];

  for (const [key, label] of requiredFields) {
    if (!String(details[key] || "").trim()) {
      return `${label} is required.`;
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) {
    return "Please enter a valid email address.";
  }

  if (details.phone.replace(/\D/g, "").length < 7) {
    return "Please enter a valid phone number.";
  }

  if (new Date(`${details.dateOfBirth}T00:00:00`) >= new Date()) {
    return "Date of birth must be a valid date in the past.";
  }

  if (calculateNights(details.checkIn, details.checkOut) < 1) {
    return "Check-out date must be after check-in date.";
  }

  if (Number(details.guests) < 1) {
    return "Number of guests must be positive.";
  }

  return "";
}

async function handleDetailsSubmit(event) {
  event.preventDefault();
  const status = event.currentTarget.querySelector(".form-status");
  const details = Object.fromEntries(new FormData(event.currentTarget).entries());
  const validationMessage = validateDetails(details);

  if (validationMessage) {
    status.textContent = validationMessage;
    return;
  }

  try {
    status.textContent = "Checking live room availability...";
    await refreshInventory();

    if (!selectedAvailable()) {
      status.textContent = "This room is no longer available. Please choose another room.";
      state.step = "select";
      render();
      return;
    }

    state.details = {
      ...details,
      guests: String(Number(details.guests)),
    };
    state.step = "confirm";
    state.message = "";
    render();
    scrollToFlow();
  } catch (error) {
    status.textContent = error.message || "Could not check room availability.";
  }
}

async function confirmPrice() {
  const status = document.querySelector(".form-status");
  try {
    status.textContent = "Re-checking room availability...";
    await refreshInventory();

    if (!selectedAvailable()) {
      state.step = "select";
      state.message = "This room is no longer available. Please choose another room type.";
      render();
      return;
    }

    state.step = "payment";
    state.message = "";
    render();
    scrollToFlow();
  } catch (error) {
    status.textContent = error.message || "Could not confirm availability.";
  }
}

function validatePayment(file, payment) {
  if (!payment.paymentMethod) {
    return "Please choose a payment method.";
  }

  if (localPaymentMethods.has(payment.paymentMethod)) {
    if (!payment.paymentReference?.trim()) {
      return "Please enter your local payment reference number.";
    }
    if (!file?.name) {
      return "Please upload your payment screenshot or proof of transfer.";
    }
  }

  if (file?.name) {
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowedTypes.has(file.type)) {
      return "Payment proof must be JPG, PNG, or WebP.";
    }
    if (file.size > 5 * 1024 * 1024) {
      return "Payment proof must be 5 MB or smaller.";
    }
  }

  return "";
}

async function handlePaymentSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = form.querySelector(".form-status");
  const formData = new FormData(form);
  const screenshot = formData.get("paymentScreenshot");
  const payment = Object.fromEntries(formData.entries());
  const validationMessage = validatePayment(screenshot, payment);

  if (validationMessage) {
    status.textContent = validationMessage;
    return;
  }

  try {
    state.isSubmitting = true;
    state.payment = {
      paymentMethod: payment.paymentMethod,
      paymentReference: payment.paymentReference || "",
    };
    status.textContent = "Checking room availability before submission...";
    await refreshInventory();

    const room = selectedRoom();
    if (!room || room.availableRooms < 1) {
      state.step = "select";
      state.message = "This room is no longer available. Please choose another room type.";
      render();
      return;
    }

    let paymentScreenshotUrl = "";
    if (screenshot && screenshot.name) {
      status.textContent = "Uploading payment proof...";
      paymentScreenshotUrl = await uploadPaymentScreenshot(screenshot, "room-bookings");
    }

    status.textContent = "Saving your room booking request...";
    const total = currentTotal();
    const result = await createRoomBooking({
      ...state.details,
      roomType: room.name,
      roomSlug: room.slug,
      roomName: room.name,
      pricePerNight: room.pricePerNight,
      nights: calculateNights(),
      estimatedTotal: total,
      paymentMethod: payment.paymentMethod,
      paymentReference: payment.paymentReference,
      paymentScreenshotUrl,
      paymentStatus:
        payment.paymentMethod === "Visa/Mastercard"
          ? "card_payment_pending"
          : "pending_payment_review",
      message: bookingMessage(state.details),
    });

    state.success = {
      bookingNumber: result.booking_number,
      roomName: room.name,
      total: formatEtb(total),
      paymentMethod: payment.paymentMethod,
    };
    state.step = "success";
    state.message = "";
    await loadInventory();
    scrollToFlow();
  } catch (error) {
    status.textContent = error.message || "Sorry, we could not save your room request. Please try WhatsApp.";
  } finally {
    state.isSubmitting = false;
  }
}

function bindPageEvents() {
  const navToggle = document.querySelector("[data-nav-toggle]");
  const navMenu = document.querySelector("[data-nav-menu]");
  navToggle?.addEventListener("click", () => {
    const expanded = navToggle.getAttribute("aria-expanded") === "true";
    navToggle.setAttribute("aria-expanded", String(!expanded));
    navMenu?.classList.toggle("is-open");
  });

  document.querySelectorAll("[data-nav-menu] a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  document.querySelectorAll("[data-select-room]").forEach((button) => {
    button.addEventListener("click", () => selectRoom(button.dataset.selectRoom));
  });

  document.querySelector("[data-back-to-select]")?.addEventListener("click", () => {
    state.step = "select";
    render();
    scrollToFlow();
  });

  document.querySelector("[data-change-room]")?.addEventListener("click", () => {
    state.step = "select";
    render();
    scrollToFlow();
  });

  document.querySelector("[data-back-to-details]")?.addEventListener("click", () => {
    state.step = "details";
    render();
    scrollToFlow();
  });

  document.querySelector("[data-back-to-confirm]")?.addEventListener("click", () => {
    state.step = "confirm";
    render();
    scrollToFlow();
  });

  document.querySelector("[data-confirm-price]")?.addEventListener("click", confirmPrice);
  document.querySelector("#guest-details-form")?.addEventListener("submit", handleDetailsSubmit);
  document.querySelector("#payment-form")?.addEventListener("submit", handlePaymentSubmit);

  document.querySelector("#room-check-in")?.addEventListener("change", (event) => {
    const checkOut = document.querySelector("#room-check-out");
    if (checkOut) {
      checkOut.min = addDaysIso(event.target.value, 1);
      if (checkOut.value && checkOut.value <= event.target.value) {
        checkOut.value = "";
      }
    }
  });

  document.querySelector("#room-payment-method")?.addEventListener("change", (event) => {
    state.payment.paymentMethod = event.target.value;
    state.payment.paymentReference =
      document.querySelector("[name='paymentReference']")?.value || state.payment.paymentReference;
    render();
  });

  if (!scrollHandlerBound) {
    window.addEventListener("scroll", setHeaderState, { passive: true });
    scrollHandlerBound = true;
  }
  setHeaderState();
}

render();
loadInventory();

if (isBackendReady()) {
  subscribeRoomInventory((inventory) => renderInventory(inventory)).catch(() => {});
}
