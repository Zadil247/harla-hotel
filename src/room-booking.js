import { Footer, Navbar } from "./components.js?v=20260519-client-feedback";
import { images, roomBookingTypes, siteConfig } from "./data.js?v=20260519-client-feedback";
import { initImageLightbox, LightboxImage, LightboxMarkup } from "./lightbox.js?v=20260519-client-feedback";
import {
  backendSetupMessage,
  createRoomBooking,
  isBackendReady,
} from "./supabase-api.js?v=20260507-supabase";

const app = document.querySelector("#room-booking-app");
const roomBySlug = new Map(roomBookingTypes.map((room) => [room.slug, room]));
const totalAvailableRooms = roomBookingTypes.reduce((total, room) => total + room.availableRooms, 0);
const roomSlugAliases = {
  "queen-standard-room": "queen-normal-room",
  "harari-cultural-room": "cultural-king-room",
};
const requestedRoomSlug = new URLSearchParams(window.location.search).get("room");
const initialRoomSlug = roomSlugAliases[requestedRoomSlug] || requestedRoomSlug;

function formatEtb(amount) {
  return `${new Intl.NumberFormat("en-US").format(amount)} ETB`;
}

function roomCard(room) {
  return `
    <article class="room-type-card reveal" data-room-card="${room.slug}">
      ${LightboxImage(room.image, room.name, "room-type-lightbox-image")}
      <div class="room-type-card-body">
        <p class="card-kicker">${room.priceLabel}</p>
        <h3>${room.name}</h3>
        <p>${room.description}</p>
        <ul class="amenities">
          ${room.features.map((feature) => `<li>${feature}</li>`).join("")}
        </ul>
        <div class="room-availability">
          <strong>${room.availableRooms}</strong>
          <span>${room.availableRooms === 1 ? "room available" : "rooms available"}</span>
        </div>
        <button class="btn btn-primary" type="button" data-select-room="${room.slug}">Select this room</button>
      </div>
    </article>
  `;
}

app.innerHTML = `
  ${Navbar("rooms")}
  <main id="room-booking-main">
    <section class="room-booking-hero" style="--page-hero-image: url('${images.hero}')">
      <div class="room-booking-hero-copy reveal">
        <p class="eyebrow">Room Booking</p>
        <h1>Book Your Stay at Harla Hotel</h1>
        <p>
          Choose your preferred room type, select your stay dates, and send a room booking request.
          Harla Hotel offers 11 rooms total, including the Cultural King Room for special stays.
        </p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#room-booking-form-section">Start Booking</a>
          <a class="btn btn-outline" href="./index.html#rooms">View Rooms</a>
        </div>
      </div>
      <div class="room-total-card reveal">
        <strong>${totalAvailableRooms}</strong>
        <span>Total rooms including the Cultural King Room</span>
      </div>
    </section>

    <section class="section room-type-section" aria-labelledby="room-types-title">
      <div class="section-heading reveal">
        <p class="eyebrow">Room Types & Prices</p>
        <h2 id="room-types-title">Select the stay that fits your visit</h2>
        <p>
          Prices and room availability are shown as placeholders for the current Harla Hotel room setup.
          Update them in the room data when rates or availability change.
        </p>
      </div>
      <div class="room-type-grid">
        ${roomBookingTypes.map(roomCard).join("")}
      </div>
    </section>

    <section class="section room-booking-workspace" id="room-booking-form-section" aria-labelledby="room-booking-title">
      <div class="room-booking-copy reveal">
        <p class="eyebrow">Booking Request</p>
        <h2 id="room-booking-title">Send your room request</h2>
        <p>
          Select your room type, dates, guest count, and number of rooms. The estimate updates automatically
          before you send the request or continue on WhatsApp.
        </p>
        <ul class="event-booking-list room-booking-list">
          <li>Double Bed Room: max 2 rooms</li>
          <li>Queen/Normal Room: max 8 rooms</li>
          <li>Cultural King Room: max 1 room</li>
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
            Email
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
            Number of rooms
            <input name="numberOfRooms" id="number-of-rooms" type="number" min="1" value="1" required />
          </label>
          <label class="form-wide">
            Special requests/message
            <textarea name="message" rows="5" placeholder="Tell us about arrival time, special stay requests, or room preferences..."></textarea>
          </label>
        </div>

        <div class="room-estimate-panel" aria-live="polite">
          <div>
            <span>Selected room</span>
            <strong data-estimate-room>Double Bed Room</strong>
          </div>
          <div>
            <span>Price per night</span>
            <strong data-estimate-price>4,000 ETB</strong>
          </div>
          <div>
            <span>Available rooms</span>
            <strong data-estimate-available>2</strong>
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
          <button class="btn btn-primary" type="submit">Send Room Booking Request</button>
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
const numberOfRooms = document.querySelector("#number-of-rooms");
const whatsappButton = document.querySelector("[data-room-whatsapp]");
const estimateRoom = document.querySelector("[data-estimate-room]");
const estimatePrice = document.querySelector("[data-estimate-price]");
const estimateAvailable = document.querySelector("[data-estimate-available]");
const estimateNights = document.querySelector("[data-estimate-nights]");
const estimateTotal = document.querySelector("[data-estimate-total]");

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

function selectedRoom() {
  return roomBySlug.get(roomType.value) || roomBookingTypes[0];
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

function buildWhatsAppHref(room, nights, rooms, total) {
  const message = [
    "Hello Harla Hotel, I want to confirm a room booking.",
    `Room type: ${room.name}`,
    checkIn.value ? `Check-in: ${checkIn.value}` : "",
    checkOut.value ? `Check-out: ${checkOut.value}` : "",
    nights ? `Nights: ${nights}` : "",
    `Rooms: ${rooms}`,
    total ? `Estimated total: ${formatEtb(total)}` : "",
  ]
    .filter(Boolean)
    .join("\\n");

  return `https://wa.me/${siteConfig.whatsapp.replace(/\\D/g, "")}?text=${encodeURIComponent(message)}`;
}

function updateEstimate() {
  const room = selectedRoom();
  const maxRooms = room.availableRooms;

  numberOfRooms.max = String(maxRooms);
  if (Number(numberOfRooms.value) > maxRooms) {
    numberOfRooms.value = String(maxRooms);
  }
  if (Number(numberOfRooms.value) < 1 || !numberOfRooms.value) {
    numberOfRooms.value = "1";
  }

  const nights = calculateNights();
  const requestedRooms = Number(numberOfRooms.value);
  const total = nights * room.pricePerNight * requestedRooms;

  estimateRoom.textContent = room.name;
  estimatePrice.textContent = room.priceLabel;
  estimateAvailable.textContent = `${room.availableRooms} ${room.availableRooms === 1 ? "room" : "rooms"}`;
  estimateNights.textContent = nights ? String(nights) : "Choose dates";
  estimateTotal.textContent = nights ? formatEtb(total) : "Choose dates";

  whatsappButton.href = buildWhatsAppHref(room, nights, requestedRooms, total);
  syncSelectedCards(room);
}

function selectRoom(slug) {
  if (!roomBySlug.has(slug)) {
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
numberOfRooms.addEventListener("input", updateEstimate);
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
  const requestedRooms = Number(numberOfRooms.value);
  const status = form.querySelector(".form-status");
  const formData = Object.fromEntries(new FormData(form).entries());

  if (!formData.fullName?.trim() || !formData.phone?.trim()) {
    status.textContent = "Please enter your full name and phone number.";
    return;
  }

  if (requestedRooms > room.availableRooms) {
    status.textContent = `${room.name} has only ${room.availableRooms} ${room.availableRooms === 1 ? "room" : "rooms"} available.`;
    numberOfRooms.focus();
    return;
  }

  if (!nights) {
    status.textContent = "Please choose a check-out date after the check-in date.";
    checkOut.focus();
    return;
  }

  const roomBookingRequest = {
    ...formData,
    roomSlug: room.slug,
    roomName: room.name,
    pricePerNight: room.pricePerNight,
    nights,
    estimatedTotal: nights * room.pricePerNight * requestedRooms,
  };

  if (!isBackendReady()) {
    console.info("Harla Hotel room booking request", {
      endpoint: siteConfig.bookingEndpoint,
      roomBookingRequest,
    });
    status.textContent = backendSetupMessage();
    return;
  }

  try {
    status.textContent = "Saving your room booking request...";
    await createRoomBooking(roomBookingRequest);
    status.textContent = "Thank you. Your room booking request was saved as pending.";
    form.reset();
    roomType.value = room.slug;
    updateEstimate();
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
if (initialRoomSlug && roomBySlug.has(initialRoomSlug)) {
  roomType.value = initialRoomSlug;
}
setHeaderState();
updateEstimate();
