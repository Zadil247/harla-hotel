import { Footer, Navbar } from "./components.js?v=20260521-room-automation";
import { images, roomBookingTypes, siteConfig } from "./data.js?v=20260521-room-automation";
import { initImageLightbox, LightboxImage, LightboxMarkup } from "./lightbox.js?v=20260521-room-automation";
import {
  backendSetupMessage,
  createRoomBooking,
  getRoomInventory,
  isBackendReady,
  subscribeRoomInventory,
  uploadPaymentScreenshot,
} from "./supabase-api.js?v=20260521-room-automation";

const app = document.querySelector("#room-booking-app");
const roomSlugAliases = {
  "double-bed-room": "twin-bed-room",
  "queen-normal-room": "queen-size-bed-room",
  "queen-standard-room": "queen-size-bed-room",
  "cultural-king-room": "vip-room",
  "harari-cultural-room": "vip-room",
};
const requestedRoomSlug = new URLSearchParams(window.location.search).get("room");
const initialRoomSlug = roomSlugAliases[requestedRoomSlug] || requestedRoomSlug;
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

function formatEtb(amount) {
  return `${new Intl.NumberFormat("en-US").format(Number(amount || 0))} ETB`;
}

function roomWithInventory(room) {
  const inventory = inventoryByType.get(room.name);
  return {
    ...room,
    totalRooms: inventory?.total_rooms ?? room.totalRooms,
    availableRooms: inventory?.available_rooms ?? room.availableRooms,
  };
}

function roomCard(room) {
  const liveRoom = roomWithInventory(room);
  return `
    <article class="room-type-card reveal" data-room-card="${room.slug}" data-room-type="${room.name}">
      ${LightboxImage(room.image, room.name, "room-type-lightbox-image")}
      <div class="room-type-card-body">
        <p class="card-kicker">${room.priceLabel}</p>
        <h3>${room.name}</h3>
        <p>${room.description}</p>
        <ul class="amenities">
          ${room.features.map((feature) => `<li>${feature}</li>`).join("")}
        </ul>
        <div class="room-availability">
          <strong data-room-card-available>${liveRoom.availableRooms}</strong>
          <span data-room-card-total>available out of ${liveRoom.totalRooms}</span>
        </div>
        <button class="btn btn-primary" type="button" data-select-room="${room.slug}">Select this room</button>
      </div>
    </article>
  `;
}

function totalRooms() {
  return Array.from(inventoryByType.values()).reduce((total, room) => total + Number(room.total_rooms || 0), 0);
}

app.innerHTML = `
  ${Navbar("rooms")}
  <main id="room-booking-main">
    <section class="room-booking-hero" style="--page-hero-image: url('${images.hero}')">
      <div class="room-booking-hero-copy reveal">
        <p class="eyebrow">Room Booking</p>
        <h1>Book Your Stay at Harla Hotel</h1>
        <p>
          Choose your preferred room type, send a pending booking request, and let Harla Hotel confirm
          availability after payment review.
        </p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#room-booking-form-section">Start Booking</a>
          <a class="btn btn-outline" href="./booking-status.html">Check Booking Status</a>
        </div>
      </div>
      <div class="room-total-card reveal">
        <strong data-total-rooms>${totalRooms()}</strong>
        <span>Total rooms across Queen, Twin, and VIP room inventory</span>
      </div>
    </section>

    <section class="section room-type-section" aria-labelledby="room-types-title">
      <div class="section-heading reveal">
        <p class="eyebrow">Room Types & Live Availability</p>
        <h2 id="room-types-title">Select the stay that fits your visit</h2>
        <p>Live availability comes from Supabase room inventory and updates after admin confirmation.</p>
      </div>
      <div class="room-type-grid">
        ${roomBookingTypes.map(roomCard).join("")}
      </div>
      <p class="availability-status" data-room-booking-inventory-status role="status" aria-live="polite"></p>
    </section>

    <section class="section room-booking-workspace" id="room-booking-form-section" aria-labelledby="room-booking-title">
      <div class="room-booking-copy reveal">
        <p class="eyebrow">Booking Request</p>
        <h2 id="room-booking-title">Send your room request</h2>
        <p>
          Enter your stay details and payment information. Your request is saved as pending until Harla Hotel
          reviews and confirms it in the admin dashboard.
        </p>
        <ul class="event-booking-list room-booking-list">
          <li>Queen Size Bed Room</li>
          <li>Twin Bed Room</li>
          <li>VIP Room</li>
        </ul>
      </div>

      <form class="booking-form room-booking-form reveal" id="room-booking-form">
        <div class="form-grid">
          <label>
            Full name
            <input name="fullName" type="text" autocomplete="name" required />
          </label>
          <label>
            Phone number
            <input name="phone" type="tel" autocomplete="tel" required />
          </label>
          <label>
            Email address
            <input name="email" type="email" autocomplete="email" />
          </label>
          <label>
            Room type
            <select name="roomType" id="room-booking-room-type" required>
              ${roomBookingTypes
                .map((room) => `<option value="${room.slug}">${room.name}</option>`)
                .join("")}
            </select>
          </label>
          <label>
            Check-in date
            <input name="checkIn" id="room-check-in" type="date" required />
          </label>
          <label>
            Check-out date
            <input name="checkOut" id="room-check-out" type="date" required />
          </label>
          <label>
            Number of guests
            <input name="guests" type="number" min="1" value="1" required />
          </label>
          <label>
            Payment method
            <select name="paymentMethod" id="room-payment-method" required>
              <option value="">Choose payment method</option>
              <option>Visa/Mastercard</option>
              <option>CBE</option>
              <option>Telebirr</option>
              <option>E-Birr</option>
            </select>
          </label>
          <label>
            Transaction/reference ID <span class="optional-field">Optional</span>
            <input name="paymentReference" type="text" placeholder="Transaction ID if available" />
          </label>
          <label>
            Payment screenshot <span class="optional-field">Optional</span>
            <input name="paymentScreenshot" type="file" accept="image/*" />
          </label>
          <label class="form-wide">
            Special requests/message
            <textarea name="message" rows="5" placeholder="Tell us about arrival time, special stay requests, or room preferences..."></textarea>
          </label>
        </div>

        <div class="payment-instructions room-payment-instructions" data-payment-instructions>
          Choose a payment method to see payment instructions.
        </div>

        <div class="room-estimate-panel" aria-live="polite">
          <div>
            <span>Selected room</span>
            <strong data-estimate-room>Queen Size Bed Room</strong>
          </div>
          <div>
            <span>Price per night</span>
            <strong data-estimate-price>4,000 ETB</strong>
          </div>
          <div>
            <span>Available rooms</span>
            <strong data-estimate-available>Checking...</strong>
          </div>
          <div>
            <span>Nights</span>
            <strong data-estimate-nights>Choose dates</strong>
          </div>
          <div class="estimate-total">
            <span>Estimated total</span>
            <strong data-estimate-total>Choose dates</strong>
          </div>
        </div>

        <div class="room-booking-actions">
          <button class="btn btn-primary" type="submit">Submit Room Booking</button>
          <!-- REPLACE: Update the WhatsApp number in src/data.js under siteConfig.whatsapp. -->
          <a class="btn btn-whatsapp" href="#" data-room-whatsapp>Confirm Booking on WhatsApp</a>
        </div>
        <p class="form-status" role="status" aria-live="polite"></p>
      </form>
    </section>
  </main>
  ${LightboxMarkup("Harla Hotel room booking image viewer")}
  ${Footer()}
`;

const header = document.querySelector("[data-header]");
const navToggle = document.querySelector("[data-nav-toggle]");
const navMenu = document.querySelector("[data-nav-menu]");
const form = document.querySelector("#room-booking-form");
const roomType = document.querySelector("#room-booking-room-type");
const checkIn = document.querySelector("#room-check-in");
const checkOut = document.querySelector("#room-check-out");
const paymentMethod = document.querySelector("#room-payment-method");
const paymentInstructions = document.querySelector("[data-payment-instructions]");
const whatsappButton = document.querySelector("[data-room-whatsapp]");
const estimateRoom = document.querySelector("[data-estimate-room]");
const estimatePrice = document.querySelector("[data-estimate-price]");
const estimateAvailable = document.querySelector("[data-estimate-available]");
const estimateNights = document.querySelector("[data-estimate-nights]");
const estimateTotal = document.querySelector("[data-estimate-total]");
const inventoryStatus = document.querySelector("[data-room-booking-inventory-status]");
const totalRoomsNode = document.querySelector("[data-total-rooms]");

const paymentMessages = {
  "Visa/Mastercard": "Online card payment integration coming soon. Submit your request and Harla Hotel will confirm payment options.",
  CBE: "CBE: 1000703782756 - Harla Hotel",
  Telebirr: "Telebirr: 0915321828 - Rekib",
  "E-Birr": "E-Birr: 0915321188",
};

function todayIso() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function addDaysIso(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function calculateNights() {
  if (!checkIn.value || !checkOut.value) {
    return 0;
  }

  const start = new Date(`${checkIn.value}T00:00:00`);
  const end = new Date(`${checkOut.value}T00:00:00`);
  const nights = Math.round((end - start) / 86_400_000);
  return nights > 0 ? nights : 0;
}

function baseSelectedRoom() {
  return roomBookingTypes.find((room) => room.slug === roomType.value) || roomBookingTypes[0];
}

function selectedRoom() {
  return roomWithInventory(baseSelectedRoom());
}

function setHeaderState() {
  header.classList.toggle("is-scrolled", window.scrollY > 20);
}

function closeMenu() {
  navToggle.setAttribute("aria-expanded", "false");
  navMenu.classList.remove("is-open");
}

function syncSelectedCards(room) {
  document.querySelectorAll("[data-room-card]").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.roomCard === room.slug);
  });
}

function buildWhatsAppHref(room, nights, total) {
  const message = [
    "Hello Harla Hotel, I want to confirm a room booking.",
    `Room type: ${room.name}`,
    checkIn.value ? `Check-in: ${checkIn.value}` : "",
    checkOut.value ? `Check-out: ${checkOut.value}` : "",
    nights ? `Nights: ${nights}` : "",
    total ? `Estimated total: ${formatEtb(total)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `https://wa.me/${siteConfig.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

function updatePaymentInstructions() {
  paymentInstructions.textContent =
    paymentMessages[paymentMethod.value] || "Choose a payment method to see payment instructions.";
}

function updateEstimate() {
  const room = selectedRoom();
  const nights = calculateNights();
  const total = nights * room.pricePerNight;

  estimateRoom.textContent = room.name;
  estimatePrice.textContent = room.priceLabel;
  estimateAvailable.textContent = `${room.availableRooms} out of ${room.totalRooms}`;
  estimateNights.textContent = nights ? String(nights) : "Choose dates";
  estimateTotal.textContent = nights ? formatEtb(total) : "Choose dates";

  whatsappButton.href = buildWhatsAppHref(room, nights, total);
  syncSelectedCards(room);
}

function renderInventory(inventory) {
  if (!inventory.length) {
    inventoryStatus.textContent = "No room inventory records found in Supabase yet.";
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

  totalRoomsNode.textContent = String(totalRooms());

  document.querySelectorAll("[data-room-type]").forEach((card) => {
    const inventoryRoom = inventoryByType.get(card.dataset.roomType);
    if (!inventoryRoom) {
      return;
    }
    card.querySelector("[data-room-card-available]").textContent = String(inventoryRoom.available_rooms);
    card.querySelector("[data-room-card-total]").textContent = `available out of ${inventoryRoom.total_rooms}`;
  });

  updateEstimate();
}

async function loadInventory() {
  if (!isBackendReady()) {
    inventoryStatus.textContent = backendSetupMessage();
    updateEstimate();
    return;
  }

  try {
    renderInventory(await getRoomInventory());
    inventoryStatus.textContent = "Room availability loaded from Supabase.";
  } catch (error) {
    inventoryStatus.textContent = error.message || "Could not load room availability.";
  }
}

function selectRoom(slug) {
  if (!roomBookingTypes.some((room) => room.slug === slug)) {
    return;
  }

  roomType.value = slug;
  updateEstimate();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

navToggle.addEventListener("click", () => {
  const expanded = navToggle.getAttribute("aria-expanded") === "true";
  navToggle.setAttribute("aria-expanded", String(!expanded));
  navMenu.classList.toggle("is-open");
});

document.querySelectorAll("[data-nav-menu] a").forEach((link) => {
  link.addEventListener("click", closeMenu);
});

document.querySelectorAll("[data-select-room]").forEach((button) => {
  button.addEventListener("click", () => selectRoom(button.dataset.selectRoom));
});

roomType.addEventListener("change", updateEstimate);
paymentMethod.addEventListener("change", updatePaymentInstructions);
checkIn.addEventListener("change", () => {
  checkOut.min = addDaysIso(checkIn.value, 1);
  if (checkOut.value && checkOut.value <= checkIn.value) {
    checkOut.value = "";
  }
  updateEstimate();
});
checkOut.addEventListener("change", updateEstimate);
window.addEventListener("scroll", setHeaderState, { passive: true });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const room = selectedRoom();
  const nights = calculateNights();
  const status = form.querySelector(".form-status");
  const formData = new FormData(form);
  const screenshot = formData.get("paymentScreenshot");
  const payload = Object.fromEntries(formData.entries());

  if (!payload.fullName?.trim() || !payload.phone?.trim()) {
    status.textContent = "Please enter your full name and phone number.";
    return;
  }

  if (!payload.paymentMethod) {
    status.textContent = "Please choose a payment method.";
    paymentMethod.focus();
    return;
  }

  if (room.availableRooms < 1) {
    status.textContent = `${room.name} is currently unavailable. Please choose another room type.`;
    return;
  }

  if (!nights) {
    status.textContent = "Please choose a check-out date after the check-in date.";
    checkOut.focus();
    return;
  }

  if (!isBackendReady()) {
    status.textContent = backendSetupMessage();
    return;
  }

  try {
    status.textContent = "Saving your room booking request...";
    let paymentScreenshotUrl = "";

    if (screenshot && screenshot.name) {
      status.textContent = "Uploading payment screenshot...";
      paymentScreenshotUrl = await uploadPaymentScreenshot(screenshot, "room-bookings");
    }

    const result = await createRoomBooking({
      ...payload,
      roomType: room.name,
      roomSlug: room.slug,
      roomName: room.name,
      pricePerNight: room.pricePerNight,
      nights,
      estimatedTotal: nights * room.pricePerNight,
      paymentScreenshotUrl,
      paymentStatus:
        payload.paymentMethod === "Visa/Mastercard"
          ? "card_payment_pending"
          : paymentScreenshotUrl || payload.paymentReference
            ? "submitted_for_verification"
            : "pending_payment_confirmation",
    });

    status.innerHTML = `
      Thank you. Your room booking is pending review.
      <strong>Booking number: ${result.booking_number}</strong>
      <a class="text-link" href="./booking-status.html?booking=${encodeURIComponent(result.booking_number)}">Check booking status</a>
    `;
    form.reset();
    roomType.value = room.slug;
    updatePaymentInstructions();
    await loadInventory();
  } catch (error) {
    status.textContent = error.message || "Sorry, we could not save your room request. Please try WhatsApp.";
  }
});

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 },
);

document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));
initImageLightbox();

checkIn.min = todayIso();
checkOut.min = addDaysIso(todayIso(), 1);
if (initialRoomSlug && roomBookingTypes.some((room) => room.slug === initialRoomSlug)) {
  roomType.value = initialRoomSlug;
}
setHeaderState();
updatePaymentInstructions();
updateEstimate();
loadInventory();

if (isBackendReady()) {
  subscribeRoomInventory(renderInventory).catch(() => {});
}
