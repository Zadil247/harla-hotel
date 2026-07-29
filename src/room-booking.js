import { Footer, Navbar } from "./components.js?v=20260702-booking-availability";
import {
  countries,
  countryFlag,
  findCountry,
  formatInternationalPhone,
  normalizeNationalNumber,
  priorityCountryCodes,
} from "./countries.js?v=20260724-booking-stage-a";
import { images, roomBookingTypes, siteConfig } from "./data.js?v=20260728-manual-payments";
import { initImageLightbox, LightboxImage, LightboxMarkup } from "./lightbox.js?v=20260702-booking-availability";
import {
  backendSetupMessage,
  createBookingReference,
  createRoomBooking,
  getRoomInventory,
  isBackendReady,
  subscribeRoomInventory,
  uploadGovernmentId,
  uploadRoomPaymentProof,
} from "./supabase-api.js?v=20260728-manual-payments";

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
const internationalTransferMethod = "international_transfer";
const paymentProofMaxSize = 10 * 1024 * 1024;
const paymentProofAllowedTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const paymentProofAllowedExtensions = new Set([
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "webp",
]);
const governmentIdMaxSize = 10 * 1024 * 1024;
const governmentIdAllowedTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const governmentIdAllowedExtensions = new Set(["pdf", "jpg", "jpeg", "png"]);
const emailDomainCorrections = new Map([
  ["gail.com", "gmail.com"],
  ["gmial.com", "gmail.com"],
  ["gnail.com", "gmail.com"],
  ["hotmial.com", "hotmail.com"],
  ["yaho.com", "yahoo.com"],
  ["yahoo.con", "yahoo.com"],
]);

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
let countryDismissBound = false;

const state = {
  step: "select",
  selectedRoomSlug: roomBookingTypes.some((room) => room.slug === initialRoomSlug) ? initialRoomSlug : "",
  details: {
    phoneCountryCode: "ET",
  },
  payment: {
    paymentMethod: "",
    paymentReference: "",
  },
  internationalQuote: null,
  internationalQuoteError: "",
  isQuoteLoading: false,
  chapaBookingNumber: "",
  governmentIdUpload: null,
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

function formatUsd(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(amount || 0));
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

function orderedCountries(priorityCodes = []) {
  const priority = priorityCodes
    .map(findCountry)
    .filter(Boolean);
  const prioritySet = new Set(priority.map((country) => country.code));
  return [
    ...priority,
    ...countries
      .filter((country) => !prioritySet.has(country.code))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ];
}

function phoneCountry() {
  return findCountry(state.details.phoneCountryCode || "ET") || findCountry("ET");
}

function nationalityCountry() {
  return findCountry(state.details.nationalityCountryCode) || null;
}

function nationalityIsEthiopian(details = state.details) {
  const countryCode = String(details.nationalityCountryCode || "").toUpperCase();
  const nationality = String(details.nationality || "").trim().toLowerCase();
  return countryCode === "ET" || nationality === "ethiopia" || nationality === "ethiopian";
}

function nationalPhoneForCountry(value, country) {
  let digits = normalizeNationalNumber(value);
  const dialDigits = String(country?.dialCode || "").replace(/\D/g, "");

  if (dialDigits && digits.startsWith(dialDigits) && digits.length > Number(country?.maxDigits || 14)) {
    digits = digits.slice(dialDigits.length);
  }

  return digits;
}

function emailValidation(value) {
  const email = String(value || "").trim();
  const basicResult = { message: "", suggestion: "" };

  if (!email) {
    return { ...basicResult, message: "Email address is required." };
  }

  if (email.length > 254 || /\s/.test(email)) {
    return { ...basicResult, message: "Please enter a valid email address." };
  }

  const parts = email.split("@");
  if (parts.length !== 2) {
    return { ...basicResult, message: "Please enter a complete email address, such as example@gmail.com." };
  }

  const [localPart, rawDomain] = parts;
  const domain = rawDomain.toLowerCase();
  const correctedDomain = emailDomainCorrections.get(domain);
  if (correctedDomain) {
    return {
      message: `Did you mean ${localPart}@${correctedDomain}?`,
      suggestion: `${localPart}@${correctedDomain}`,
    };
  }

  const localPartIsValid =
    localPart.length > 0 &&
    localPart.length <= 64 &&
    !localPart.startsWith(".") &&
    !localPart.endsWith(".") &&
    !localPart.includes("..") &&
    /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart);
  const domainLabels = domain.split(".");
  const domainIsValid =
    domainLabels.length >= 2 &&
    domainLabels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        !label.startsWith("-") &&
        !label.endsWith("-") &&
        /^[a-z0-9-]+$/i.test(label),
    ) &&
    /^[a-z]{2,63}$/i.test(domainLabels.at(-1) || "");

  if (!localPartIsValid || !domainIsValid) {
    return { ...basicResult, message: "Please enter a valid email address, such as example@gmail.com." };
  }

  return basicResult;
}

function countryOptionMarkup(country, target) {
  return `
    <button
      class="country-option"
      type="button"
      role="option"
      data-country-option="${target}"
      data-country-code="${country.code}"
      data-country-search="${escapeHtml(`${country.name} ${country.dialCode} ${country.code}`.toLowerCase())}"
    >
      <span class="country-option-flag" aria-hidden="true">${countryFlag(country.code)}</span>
      <span class="country-option-name">${escapeHtml(country.name)}</span>
      ${target === "phone" ? `<small>${country.dialCode}</small>` : ""}
    </button>
  `;
}

function countryOptionsMarkup(target) {
  const priorityCodes = target === "phone" ? priorityCountryCodes : ["ET"];
  const prioritySet = new Set(priorityCodes);
  const options = orderedCountries(priorityCodes);

  return options
    .map((country, index) => {
      const showDivider =
        index > 0 &&
        prioritySet.has(options[index - 1]?.code) &&
        !prioritySet.has(country.code);
      return `${showDivider ? '<div class="country-option-divider" role="separator"></div>' : ""}${countryOptionMarkup(country, target)}`;
    })
    .join("");
}

function phoneFieldMarkup() {
  const selectedCountry = phoneCountry();
  const nationalNumber = state.details.phoneNationalNumber || "";

  return `
    <div class="booking-field phone-booking-field">
      <label for="booking-phone-national">Phone number</label>
      <div class="phone-input-shell">
        <div class="country-combobox" data-country-combobox="phone">
          <button
            class="country-trigger"
            type="button"
            aria-expanded="false"
            aria-haspopup="listbox"
            aria-controls="phone-country-menu"
            data-country-trigger="phone"
          >
            <span aria-hidden="true">${countryFlag(selectedCountry.code)}</span>
            <strong>${selectedCountry.dialCode}</strong>
            <span class="country-trigger-chevron" aria-hidden="true">⌄</span>
          </button>
          <div class="country-menu" id="phone-country-menu" data-country-menu="phone" hidden>
            <div class="country-search-wrap">
              <label class="sr-only" for="phone-country-search">Search countries</label>
              <input
                id="phone-country-search"
                class="country-search"
                type="search"
                autocomplete="off"
                placeholder="Search country or code"
                data-country-search-input="phone"
              />
            </div>
            <div class="country-option-list" role="listbox" aria-label="Phone country">
              ${countryOptionsMarkup("phone")}
            </div>
            <p class="country-no-results" data-country-empty="phone" hidden>No matching country found.</p>
          </div>
        </div>
        <input name="phoneCountryCode" type="hidden" value="${selectedCountry.code}" />
        <input
          id="booking-phone-national"
          name="phoneNationalNumber"
          type="tel"
          inputmode="tel"
          autocomplete="tel-national"
          value="${escapeHtml(nationalNumber)}"
          placeholder="${selectedCountry.code === "ET" ? "912 345 678" : "National phone number"}"
          aria-describedby="phone-field-hint"
          required
        />
      </div>
      <small class="booking-field-hint" id="phone-field-hint">
        ${escapeHtml(selectedCountry.name)} ${selectedCountry.dialCode}. Enter the number without the international country code.
      </small>
      <small class="booking-field-feedback" data-phone-feedback aria-live="polite"></small>
    </div>
  `;
}

function nationalityFieldMarkup() {
  const selectedCountry = nationalityCountry();
  const inputValue = selectedCountry?.name || state.details.nationalitySearch || state.details.nationality || "";

  return `
    <div class="booking-field nationality-booking-field" data-country-combobox="nationality">
      <label for="booking-nationality-search">Nationality</label>
      <div class="nationality-input-wrap">
        <span class="nationality-flag" data-nationality-flag aria-hidden="true">${selectedCountry ? countryFlag(selectedCountry.code) : "◎"}</span>
        <input
          id="booking-nationality-search"
          name="nationalitySearch"
          type="search"
          autocomplete="off"
          role="combobox"
          aria-expanded="false"
          aria-autocomplete="list"
          aria-controls="nationality-country-menu"
          value="${escapeHtml(inputValue)}"
          placeholder="Search nationality or country"
          data-nationality-input
          required
        />
        <input name="nationalityCountryCode" type="hidden" value="${escapeHtml(selectedCountry?.code || "")}" />
        <input name="nationality" type="hidden" value="${escapeHtml(selectedCountry?.name || "")}" />
      </div>
      <div class="country-menu nationality-menu" id="nationality-country-menu" data-country-menu="nationality" hidden>
        <div class="country-option-list" role="listbox" aria-label="Nationality">
          ${countryOptionsMarkup("nationality")}
        </div>
        <p class="country-no-results" data-country-empty="nationality" hidden>No matching nationality found.</p>
      </div>
      <small class="booking-field-hint">Start typing, then select a valid country from the list.</small>
      <small class="booking-field-feedback" data-nationality-feedback aria-live="polite"></small>
    </div>
  `;
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
    "E-Birr": `eBirr: 0915321188. ${amount}`,
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
            <label class="booking-field">
              Full name
              <input
                name="fullName"
                type="text"
                autocomplete="name"
                value="${escapeHtml(state.details.fullName || "")}"
                placeholder="John Doe Smith"
                required
              />
            </label>
            <label class="booking-field email-booking-field">
              Email address
              <input
                name="email"
                type="email"
                inputmode="email"
                autocomplete="email"
                value="${escapeHtml(state.details.email || "")}"
                placeholder="example@gmail.com"
                aria-describedby="email-field-hint email-field-feedback"
                required
              />
              <small class="booking-field-hint" id="email-field-hint">
                Example: <strong>example@gmail.com</strong>
              </small>
              <small class="booking-field-feedback" id="email-field-feedback" data-email-feedback aria-live="polite"></small>
            </label>
            ${phoneFieldMarkup()}
            <label>
              Date of birth
              <input name="dateOfBirth" type="date" max="${escapeHtml(todayIso())}" value="${escapeHtml(state.details.dateOfBirth || "")}" required />
            </label>
            ${nationalityFieldMarkup()}
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
          <div class="guest-id-upload form-wide">
            <div class="guest-id-upload-heading">
              <div>
                <span>Secure verification</span>
                <strong>Government-issued ID</strong>
              </div>
              <small>PDF, JPG, JPEG, or PNG. Max 10 MB.</small>
            </div>
            <label class="guest-id-upload-control">
              <input
                name="governmentId"
                type="file"
                accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              />
              <span class="guest-id-upload-badge">ID</span>
              <span class="guest-id-upload-copy">
                <strong>${state.details.governmentIdFileName ? "Selected ID file" : "Choose ID file"}</strong>
                <small data-government-id-file-name>${escapeHtml(state.details.governmentIdFileName || "No file selected yet")}</small>
              </span>
            </label>
            <p class="guest-id-upload-status ${state.details.governmentIdFileName ? "is-success" : ""}" data-government-id-status>
              ${
                state.details.governmentIdFileName
                  ? "ID file is ready for secure upload when you submit payment."
                  : "Upload a passport, national ID, driving license, or other government-issued ID."
              }
            </p>
            <p class="guest-id-privacy-note">
              Your government-issued ID is required for booking verification and is stored securely. It is only accessible to authorized Harla Hotel admins.
            </p>
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
      <div><dt>Nationality</dt><dd>${escapeHtml(state.details.nationality || "-")}</dd></div>
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

function chapaPaymentOption() {
  return `
    <section class="chapa-checkout-card" aria-labelledby="chapa-checkout-title">
      <div class="chapa-checkout-heading">
        <span class="chapa-secure-mark" aria-hidden="true">Secure</span>
        <div>
          <p class="eyebrow">Primary Secure Payment</p>
          <h3 id="chapa-checkout-title">Pay with Chapa Hosted Checkout</h3>
        </div>
      </div>
      <p>
        Continue to Chapa's secure hosted payment page. Harla Hotel will confirm the booking only after the server verifies the transaction directly with Chapa.
      </p>
      <div class="chapa-checkout-total">
        <span>Amount charged by Chapa</span>
        <strong>${formatEtb(currentTotal())}</strong>
      </div>
      <button
        class="btn btn-primary chapa-checkout-button"
        type="button"
        data-start-chapa-checkout
        ${state.isSubmitting ? "disabled" : ""}
      >
        ${state.isSubmitting ? "Opening Chapa Secure Checkout..." : "Pay Securely with Chapa"}
      </button>
      <p class="chapa-checkout-status" data-chapa-checkout-status role="status" aria-live="polite"></p>
      <small>Prefer a manual payment? Use the verification form below as a fallback.</small>
    </section>
  `;
}

function paymentStep() {
  const room = selectedRoom();
  const isEthiopianGuest = nationalityIsEthiopian();
  const method =
    isEthiopianGuest && localPaymentMethods.has(state.payment.paymentMethod)
      ? state.payment.paymentMethod
      : "";
  const isLocalPayment = localPaymentMethods.has(method);
  const selectedNationality = nationalityCountry()?.name || state.details.nationality || "your nationality";

  if (!isEthiopianGuest) {
    const quote = state.internationalQuote;
    const hasTransferInstructions = Boolean(
      String(siteConfig.internationalTransferInstructions || "").trim(),
    );
    const quoteStatus = state.isQuoteLoading
      ? `
        <div class="secure-payment-state is-loading" role="status" aria-live="polite">
          <span class="payment-loading-mark" aria-hidden="true"></span>
          <div>
            <strong>Preparing today’s USD booking quote</strong>
            <small>Harla Hotel is checking the current ETB/USD rate securely through the server.</small>
          </div>
        </div>
      `
      : state.internationalQuoteError
        ? `
          <div class="secure-payment-state is-error" role="alert">
            <strong>International transfer quote is unavailable</strong>
            <p>${escapeHtml(state.internationalQuoteError)}</p>
            <button class="text-link" type="button" data-retry-international-quote>Try loading the USD quote again</button>
          </div>
        `
        : quote
          ? `
            <div class="international-quote-card">
              <div>
                <span>Original room total</span>
                <strong>${formatEtb(quote.totalEtb)}</strong>
              </div>
              <div class="international-quote-total">
                <span>International transfer total</span>
                <strong>${formatUsd(quote.totalUsd)}</strong>
              </div>
              <p>
                Rate used: 1 USD = ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(
                  quote.etbPerUsd,
                )} ETB · ${escapeHtml(quote.exchangeRateDate)} · ${escapeHtml(quote.provider)}
              </p>
            </div>
          `
          : "";

    return `
      <section class="booking-step-panel booking-payment-layout" aria-labelledby="payment-title">
        <div class="booking-panel-heading">
          <p class="eyebrow">Step 4</p>
          <h2 id="payment-title">International transfer</h2>
          <p>Based on ${escapeHtml(selectedNationality)}, this booking uses manual international transfer verification in USD.</p>
        </div>
        <div class="booking-details-grid">
          <aside class="selected-room-panel payment-summary-panel">
            <p class="eyebrow">Booking Summary</p>
            <h3>${escapeHtml(room?.name || "-")}</h3>
            ${summaryRows()}
          </aside>
          <div class="payment-choice-stack">
            ${chapaPaymentOption()}
            <form class="booking-form premium-booking-form international-payment-panel" id="payment-form">
              <div class="payment-route-badge">
                <span aria-hidden="true">USD</span>
                <div>
                  <strong>International Transfer — Manual Verification</strong>
                  <small>Your transfer proof will be checked by Harla Hotel before confirmation.</small>
                </div>
              </div>
              <div class="international-activation-notice">
                <strong>Manual international transfer fallback</strong>
                <p>If you cannot use Chapa, complete the transfer using the instructions below and upload your payment confirmation.</p>
              </div>
              ${quoteStatus}
              <section class="international-transfer-instructions" aria-labelledby="international-transfer-instructions-title">
                <p class="eyebrow">Transfer Instructions</p>
                <h3 id="international-transfer-instructions-title">Receive current payment details</h3>
                ${
                  hasTransferInstructions
                    ? `<p>${escapeHtml(siteConfig.internationalTransferInstructions)}</p>`
                    : `
                      <p>Please contact Harla Hotel to receive the current international transfer details.</p>
                      <div class="international-transfer-contacts">
                        <a href="mailto:${siteConfig.email}">${siteConfig.email}</a>
                        <a href="tel:${siteConfig.phone.replace(/\s/g, "")}">${siteConfig.phone}</a>
                      </div>
                    `
                }
              </section>
              <input name="paymentMethod" type="hidden" value="${internationalTransferMethod}" />
              <div class="form-grid international-transfer-form-grid">
                <label>
                  Transaction or transfer reference number
                  <input name="paymentReference" type="text" value="${escapeHtml(state.payment.paymentReference || "")}" placeholder="Transfer/reference ID" required />
                </label>
                <label>
                  Sender/account name <span class="optional-field">Optional</span>
                  <input name="senderName" type="text" placeholder="Name shown on the transfer" maxlength="160" />
                </label>
                <label>
                  Payment date
                  <input name="paymentDate" type="date" max="${todayIso()}" value="${todayIso()}" required />
                </label>
                <label>
                  Amount transferred in USD
                  <input name="amountTransferredUsd" type="number" min="0.01" step="0.01" value="${quote ? Number(quote.totalUsd).toFixed(2) : ""}" placeholder="0.00" required />
                </label>
                <label class="form-wide payment-proof-field">
                  Payment confirmation screenshot or PDF
                  <span class="payment-proof-control">
                    <input name="paymentProof" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required />
                    <span>
                      <strong>Choose transfer confirmation</strong>
                      <small data-payment-proof-file>PDF, JPG, PNG, or WebP. Maximum 10 MB.</small>
                    </span>
                  </span>
                </label>
              </div>
              <div class="payment-review-note">
                Your booking and transfer proof will be saved as Pending Payment Confirmation. It is not paid or confirmed until an authorized Harla Hotel admin approves it.
              </div>
              <div class="room-booking-actions">
                <button class="btn btn-light" type="button" data-back-to-confirm>Back to Confirmation</button>
                <button
                  class="btn btn-primary"
                  type="submit"
                  ${!quote || state.isQuoteLoading || state.isSubmitting ? "disabled" : ""}
                >
                  ${state.isSubmitting ? "Submitting for Verification..." : "Submit Transfer for Verification"}
                </button>
              </div>
              <p class="form-status" role="status" aria-live="polite"></p>
            </form>
          </div>
        </div>
      </section>
    `;
  }

  return `
    <section class="booking-step-panel booking-payment-layout" aria-labelledby="payment-title">
      <div class="booking-panel-heading">
        <p class="eyebrow">Step 4</p>
        <h2 id="payment-title">Local Ethiopian payment</h2>
        <p>Because Ethiopian nationality was selected, your ETB booking can be paid through CBE, Telebirr, or eBirr.</p>
      </div>
      <div class="booking-details-grid">
        <aside class="selected-room-panel payment-summary-panel">
          <p class="eyebrow">Booking Summary</p>
          <h3>${escapeHtml(room?.name || "-")}</h3>
          ${summaryRows()}
        </aside>
        <div class="payment-choice-stack">
          ${chapaPaymentOption()}
          <form class="booking-form premium-booking-form" id="payment-form">
            <div class="form-grid">
              <label class="form-wide">
                Manual payment method
                <select name="paymentMethod" id="room-payment-method" required>
                  <option value="">Choose payment method</option>
                  <option ${method === "CBE" ? "selected" : ""}>CBE</option>
                  <option ${method === "Telebirr" ? "selected" : ""}>Telebirr</option>
                  <option value="E-Birr" ${method === "E-Birr" ? "selected" : ""}>eBirr</option>
                </select>
              </label>
              <div class="payment-instructions room-payment-instructions form-wide" data-payment-instructions>
                ${escapeHtml(paymentInstructions(method))}
              </div>
              <label>
                Payment reference number
                <input name="paymentReference" type="text" value="${escapeHtml(state.payment.paymentReference || "")}" placeholder="Transaction/reference ID" required />
              </label>
              <label class="payment-proof-field">
                Payment screenshot/proof
                <span class="payment-proof-control">
                  <input name="paymentProof" type="file" accept="image/jpeg,image/png,image/webp" required />
                  <span>
                    <strong>Choose payment proof</strong>
                    <small data-payment-proof-file>JPG, PNG, or WebP. Maximum 10 MB.</small>
                  </span>
                </span>
              </label>
            </div>
            <div class="payment-review-note">
              ${
                isLocalPayment
                  ? "Your booking will remain Pending Payment Confirmation until Harla Hotel checks and approves your payment proof."
                  : "Choose a manual payment method to view the hotel account details and proof requirements."
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
      </div>
    </section>
  `;
}

function successStep() {
  return `
    <section class="booking-step-panel booking-success-panel" aria-labelledby="booking-success-title">
      <p class="eyebrow">Booking Submitted</p>
      <h2 id="booking-success-title">Thank you for choosing Harla Hotel.</h2>
      <p>Your booking request and payment proof have been received and are pending verification.</p>
      <dl class="booking-summary-list">
        <div><dt>Booking reference</dt><dd>${escapeHtml(state.success?.bookingNumber || "-")}</dd></div>
        <div><dt>Customer name</dt><dd>${escapeHtml(state.success?.customerName || "-")}</dd></div>
        <div><dt>Room type</dt><dd>${escapeHtml(state.success?.roomName || "-")}</dd></div>
        <div><dt>Check-in date</dt><dd>${escapeHtml(state.success?.checkIn || "-")}</dd></div>
        <div><dt>Check-out date</dt><dd>${escapeHtml(state.success?.checkOut || "-")}</dd></div>
        <div><dt>Number of nights</dt><dd>${escapeHtml(state.success?.nights || "-")}</dd></div>
        <div><dt>Amount submitted</dt><dd>${escapeHtml(state.success?.amountSubmitted || "-")}</dd></div>
        <div><dt>Currency</dt><dd>${escapeHtml(state.success?.currency || "-")}</dd></div>
        <div><dt>Payment method</dt><dd>${escapeHtml(state.success?.paymentMethod || "-")}</dd></div>
        <div><dt>Status</dt><dd>Pending Payment Verification</dd></div>
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

function bookingMessage(details, payment = {}) {
  const notes = [];

  if (details.message) {
    notes.push(`Special requests: ${details.message}`);
  }
  if (payment.paymentMethod === internationalTransferMethod) {
    notes.push("Payment route: International Transfer — Manual Verification");
    notes.push(
      `Sender/account name: ${String(payment.senderName || "").trim() || "Not provided"}`,
    );
    notes.push(`Payment date: ${payment.paymentDate || "Not provided"}`);
    notes.push(
      `Amount customer reported transferring: ${payment.amountTransferredUsd || "Not provided"} USD`,
    );
  }

  return notes.join("\n");
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
            Select a live room type, enter guest details, confirm your stay price, and continue to the secure payment route for your nationality.
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
    ["phoneNationalNumber", "Phone number"],
    ["phoneCountryCode", "Phone country"],
    ["dateOfBirth", "Date of birth"],
    ["nationality", "Nationality"],
    ["nationalityCountryCode", "Nationality selection"],
    ["checkIn", "Check-in date"],
    ["checkOut", "Check-out date"],
    ["guests", "Number of guests"],
  ];

  for (const [key, label] of requiredFields) {
    if (!String(details[key] || "").trim()) {
      return `${label} is required.`;
    }
  }

  const emailResult = emailValidation(details.email);
  if (emailResult.message) {
    return emailResult.message;
  }

  const selectedPhoneCountry = findCountry(details.phoneCountryCode);
  const nationalPhone = nationalPhoneForCountry(details.phoneNationalNumber, selectedPhoneCountry);
  if (!selectedPhoneCountry) {
    return "Please select a valid phone country.";
  }
  if (
    nationalPhone.length < selectedPhoneCountry.minDigits ||
    nationalPhone.length > selectedPhoneCountry.maxDigits ||
    `${selectedPhoneCountry.dialCode}${nationalPhone}`.replace(/\D/g, "").length > 15
  ) {
    const expectedLength =
      selectedPhoneCountry.minDigits === selectedPhoneCountry.maxDigits
        ? `${selectedPhoneCountry.minDigits} digits`
        : `${selectedPhoneCountry.minDigits} to ${selectedPhoneCountry.maxDigits} digits`;
    return `Please enter a valid ${selectedPhoneCountry.name} phone number (${expectedLength}).`;
  }

  const selectedNationality = findCountry(details.nationalityCountryCode);
  if (!selectedNationality || selectedNationality.name !== details.nationality) {
    return "Please choose a valid nationality from the list.";
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

function governmentIdMimeType(file) {
  const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
  const extensionTypes = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
  };
  return file?.type || extensionTypes[extension] || "";
}

function validateGovernmentIdFile(file) {
  if (!file || !file.name) {
    return "Government-issued ID upload is required.";
  }

  const extension = String(file.name || "").split(".").pop()?.toLowerCase();
  const mimeType = governmentIdMimeType(file);
  if (!governmentIdAllowedTypes.has(mimeType) || !governmentIdAllowedExtensions.has(extension)) {
    return "Government-issued ID must be a PDF, JPG, JPEG, or PNG file.";
  }

  if (file.size > governmentIdMaxSize) {
    return "Government-issued ID must be 10 MB or smaller.";
  }

  return "";
}

async function handleDetailsSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = form.querySelector(".form-status");
  const formData = new FormData(form);
  const uploadedGovernmentId = formData.get("governmentId");
  const governmentIdFile = uploadedGovernmentId?.name
    ? uploadedGovernmentId
    : state.details.governmentIdFile;
  const details = Object.fromEntries(formData.entries());
  delete details.governmentId;
  const selectedPhoneCountry = findCountry(details.phoneCountryCode);
  const nationalPhone = nationalPhoneForCountry(details.phoneNationalNumber, selectedPhoneCountry);
  const selectedNationality = findCountry(details.nationalityCountryCode);
  details.phoneCountryName = selectedPhoneCountry?.name || "";
  details.phoneCountryCode = selectedPhoneCountry?.code || "";
  details.phoneNationalNumber = nationalPhone;
  details.phoneInternational = formatInternationalPhone(selectedPhoneCountry, nationalPhone);
  details.phone = details.phoneInternational;
  details.nationality = selectedNationality?.name || "";
  details.nationalitySearch = details.nationality;
  const validationMessage = validateDetails(details);

  if (validationMessage) {
    status.textContent = validationMessage;
    return;
  }

  const governmentIdValidationMessage = validateGovernmentIdFile(governmentIdFile);
  if (governmentIdValidationMessage) {
    status.textContent = governmentIdValidationMessage;
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
      email: String(details.email || "").trim(),
      guests: String(Number(details.guests)),
      governmentIdFile,
      governmentIdFileName: governmentIdFile.name,
      governmentIdMimeType: governmentIdMimeType(governmentIdFile),
      governmentIdFileSize: governmentIdFile.size,
    };
    state.payment = {
      paymentMethod: "",
      paymentReference: "",
    };
    state.internationalQuote = null;
    state.internationalQuoteError = "";
    state.chapaBookingNumber = "";
    state.governmentIdUpload = null;
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

    if (!nationalityIsEthiopian()) {
      await loadInternationalQuote();
    }
  } catch (error) {
    status.textContent = error.message || "Could not confirm availability.";
  }
}

async function paymentApiJson(url, options = {}) {
  const { headers = {}, ...requestOptions } = options;
  const response = await fetch(url, {
    ...requestOptions,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The secure payment service is not available in this local preview. Run it through Vercel with the required server environment variables.",
    );
  }

  if (!response.ok) {
    throw new Error(data.error || "The secure payment service could not complete this request.");
  }
  return data;
}

async function loadInternationalQuote() {
  if (nationalityIsEthiopian()) {
    return;
  }

  state.isQuoteLoading = true;
  state.internationalQuoteError = "";
  render();

  try {
    const quote = await paymentApiJson(
      `/api/exchange-rate?amount_etb=${encodeURIComponent(currentTotal())}`,
    );
    if (
      !Number.isFinite(Number(quote.totalUsd)) ||
      !Number.isFinite(Number(quote.etbPerUsd))
    ) {
      throw new Error("The exchange-rate service returned an incomplete quote.");
    }
    state.internationalQuote = quote;
  } catch (error) {
    state.internationalQuote = null;
    state.internationalQuoteError =
      error.message ||
      `The USD conversion service is temporarily unavailable. Please contact ${siteConfig.phone}.`;
  } finally {
    state.isQuoteLoading = false;
    if (!state.isSubmitting) {
      render();
    }
  }
}

async function ensureGovernmentIdUploaded(bookingNumber, status) {
  if (
    state.governmentIdUpload?.bookingNumber === bookingNumber &&
    state.governmentIdUpload?.path
  ) {
    return state.governmentIdUpload;
  }

  status.textContent = "Uploading your government ID securely...";
  const upload = await uploadGovernmentId(
    state.details.governmentIdFile,
    bookingNumber,
  );
  state.governmentIdUpload = {
    ...upload,
    bookingNumber,
  };
  return state.governmentIdUpload;
}

async function startChapaCheckout() {
  if (state.isSubmitting) {
    return;
  }

  const status = document.querySelector("[data-chapa-checkout-status]");
  const button = document.querySelector("[data-start-chapa-checkout]");
  let checkoutError = "";
  let isRedirecting = false;

  try {
    state.isSubmitting = true;
    if (button) {
      button.disabled = true;
      button.textContent = "Opening Chapa Secure Checkout...";
    }
    status.textContent = "Checking live room availability...";
    await refreshInventory();

    const room = selectedRoom();
    if (!room || room.availableRooms < 1) {
      state.step = "select";
      state.message =
        "This room is no longer available. Please choose another room type.";
      render();
      return;
    }

    const bookingNumber = state.chapaBookingNumber || createBookingReference();
    state.chapaBookingNumber = bookingNumber;
    const governmentId = await ensureGovernmentIdUploaded(bookingNumber, status);

    status.textContent = "Creating your secure Chapa hosted checkout...";
    const checkout = await paymentApiJson("/api/chapa-initialize", {
      method: "POST",
      body: JSON.stringify({
        ...state.details,
        bookingNumber,
        roomType: room.name,
        roomSlug: room.slug,
        message: bookingMessage(state.details),
        governmentIdPath: governmentId.path,
        governmentIdFileName: governmentId.fileName,
        governmentIdMimeType: governmentId.mimeType,
        governmentIdFileSize: governmentId.fileSize,
        governmentIdUploadedAt: governmentId.uploadedAt,
      }),
    });

    const checkoutUrl = new URL(checkout.checkoutUrl);
    if (
      checkoutUrl.protocol !== "https:" ||
      !(
        checkoutUrl.hostname === "chapa.co" ||
        checkoutUrl.hostname.endsWith(".chapa.co")
      )
    ) {
      throw new Error("The Chapa secure checkout URL could not be verified.");
    }

    isRedirecting = true;
    window.location.assign(checkoutUrl.href);
  } catch (error) {
    checkoutError =
      error.message ||
      "Chapa secure checkout could not be opened. Please try again or use a manual payment option.";
  } finally {
    state.isSubmitting = false;
    if (!isRedirecting) {
      render();
      const currentStatus = document.querySelector(
        "[data-chapa-checkout-status]",
      );
      if (currentStatus) {
        currentStatus.textContent = checkoutError;
      }
    }
  }
}

function validatePaymentProof(file, allowPdf = false) {
  if (!file?.name) {
    return "Please upload your payment confirmation or proof of transfer.";
  }

  const extension = String(file.name || "").split(".").pop()?.toLowerCase();
  const allowedTypes = allowPdf
    ? paymentProofAllowedTypes
    : new Set(["image/jpeg", "image/png", "image/webp"]);
  const allowedExtensions = allowPdf
    ? paymentProofAllowedExtensions
    : new Set(["jpg", "jpeg", "png", "webp"]);

  if (!allowedTypes.has(file.type) || !allowedExtensions.has(extension)) {
    return allowPdf
      ? "International transfer proof must be PDF, JPG, JPEG, PNG, or WebP."
      : "Payment proof must be JPG, JPEG, PNG, or WebP.";
  }
  if (file.size > paymentProofMaxSize) {
    return "Payment proof must be 10 MB or smaller.";
  }

  return "";
}

function validatePayment(file, payment) {
  const isEthiopianGuest = nationalityIsEthiopian();

  if (!payment.paymentMethod) {
    return "Please choose a payment method.";
  }

  if (isEthiopianGuest && !localPaymentMethods.has(payment.paymentMethod)) {
    return "Please choose CBE, Telebirr, or eBirr for an Ethiopian booking.";
  }
  if (
    !isEthiopianGuest &&
    payment.paymentMethod !== internationalTransferMethod
  ) {
    return "International guests must use International Transfer — Manual Verification.";
  }

  if (!payment.paymentReference?.trim()) {
    return "Please enter the payment or transfer reference number.";
  }

  const proofValidation = validatePaymentProof(file, !isEthiopianGuest);
  if (proofValidation) {
    return proofValidation;
  }

  if (!isEthiopianGuest) {
    if (!state.internationalQuote) {
      return "The verified USD quote must load before this transfer can be submitted.";
    }
    if (!payment.paymentDate) {
      return "Please enter the payment date.";
    }
    const paymentDate = new Date(`${payment.paymentDate}T00:00:00`);
    if (
      Number.isNaN(paymentDate.getTime()) ||
      payment.paymentDate > todayIso()
    ) {
      return "Payment date must be a valid date that is not in the future.";
    }
    if (Number(payment.amountTransferredUsd) <= 0) {
      return "Please enter the amount transferred in USD.";
    }
  }

  return "";
}

async function handlePaymentSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = form.querySelector(".form-status");
  const formData = new FormData(form);
  const paymentProof = formData.get("paymentProof");
  const payment = Object.fromEntries(formData.entries());
  const isEthiopianGuest = nationalityIsEthiopian();
  const validationMessage = validatePayment(paymentProof, payment);

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

    const bookingNumber = createBookingReference();
    status.textContent = "Step 1 of 3: uploading government ID securely...";
    const governmentId = await ensureGovernmentIdUploaded(bookingNumber, status);

    let paymentScreenshotUrl = "";
    if (paymentProof && paymentProof.name) {
      status.textContent = "Step 2 of 3: uploading payment proof securely...";
      paymentScreenshotUrl = await uploadRoomPaymentProof(
        paymentProof,
        bookingNumber,
      );
    }

    status.textContent = "Step 3 of 3: saving your pending booking request...";
    const total = currentTotal();
    const quote = isEthiopianGuest ? null : state.internationalQuote;
    const paymentMethod = isEthiopianGuest
      ? payment.paymentMethod
      : internationalTransferMethod;
    const paymentCurrency = isEthiopianGuest ? "ETB" : "USD";
    const amountSubmitted = isEthiopianGuest
      ? total
      : Number(payment.amountTransferredUsd);
    const result = await createRoomBooking({
      ...state.details,
      roomType: room.name,
      roomSlug: room.slug,
      roomName: room.name,
      pricePerNight: room.pricePerNight,
      bookingNumber,
      nights: calculateNights(),
      estimatedTotal: total,
      totalPriceUsd: quote?.totalUsd,
      exchangeRate: quote?.etbPerUsd,
      exchangeRateDate: quote?.exchangeRateDate,
      paymentCurrency,
      paymentMethod,
      paymentReference: payment.paymentReference,
      paymentScreenshotUrl,
      paymentStatus: "pending_payment_confirmation",
      message: bookingMessage(state.details, {
        paymentMethod,
        senderName: payment.senderName,
        paymentDate: payment.paymentDate,
        amountTransferredUsd: payment.amountTransferredUsd,
      }),
      governmentIdPath: governmentId.path,
      governmentIdFileName: governmentId.fileName,
      governmentIdMimeType: governmentId.mimeType,
      governmentIdFileSize: governmentId.fileSize,
      governmentIdUploadedAt: governmentId.uploadedAt,
    });

    state.success = {
      bookingNumber: result.booking_number,
      customerName: state.details.fullName,
      roomName: room.name,
      checkIn: state.details.checkIn,
      checkOut: state.details.checkOut,
      nights: calculateNights(),
      amountSubmitted: isEthiopianGuest
        ? formatEtb(amountSubmitted)
        : formatUsd(amountSubmitted),
      currency: paymentCurrency,
      paymentMethod:
        paymentMethod === internationalTransferMethod
          ? "International Transfer — Manual Verification"
          : paymentMethod,
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

function setCountryMenuOpen(target, shouldOpen) {
  const menu = document.querySelector(`[data-country-menu="${target}"]`);
  const trigger =
    target === "phone"
      ? document.querySelector(`[data-country-trigger="${target}"]`)
      : document.querySelector("[data-nationality-input]");

  if (!menu || !trigger) {
    return;
  }

  menu.hidden = !shouldOpen;
  trigger.setAttribute("aria-expanded", String(shouldOpen));

  if (shouldOpen && target === "phone") {
    const search = menu.querySelector("[data-country-search-input='phone']");
    if (search) {
      search.value = "";
      filterCountryOptions("phone", "");
    }
    window.setTimeout(() => search?.focus(), 0);
  }
}

function closeCountryMenus(exceptTarget = "") {
  ["phone", "nationality"].forEach((target) => {
    if (target !== exceptTarget) {
      setCountryMenuOpen(target, false);
    }
  });
}

function filterCountryOptions(target, query) {
  const menu = document.querySelector(`[data-country-menu="${target}"]`);
  if (!menu) {
    return;
  }

  const search = String(query || "").trim().toLowerCase();
  let visibleOptions = 0;
  menu.querySelectorAll("[data-country-option]").forEach((option) => {
    const matches = !search || option.dataset.countrySearch.includes(search);
    option.hidden = !matches;
    visibleOptions += matches ? 1 : 0;
  });
  menu.querySelectorAll(".country-option-divider").forEach((divider) => {
    divider.hidden = Boolean(search);
  });

  const emptyState = menu.querySelector(`[data-country-empty="${target}"]`);
  if (emptyState) {
    emptyState.hidden = visibleOptions > 0;
  }
}

function selectCountryOption(target, code) {
  const country = findCountry(code);
  if (!country) {
    return;
  }

  if (target === "phone") {
    const countryCodeInput = document.querySelector("[name='phoneCountryCode']");
    const trigger = document.querySelector("[data-country-trigger='phone']");
    const hint = document.querySelector("#phone-field-hint");
    const nationalInput = document.querySelector("[name='phoneNationalNumber']");
    const feedback = document.querySelector("[data-phone-feedback]");

    if (countryCodeInput) {
      countryCodeInput.value = country.code;
    }
    if (trigger) {
      trigger.querySelector("span")?.replaceChildren(countryFlag(country.code));
      const dialCode = trigger.querySelector("strong");
      if (dialCode) {
        dialCode.textContent = country.dialCode;
      }
    }
    if (hint) {
      hint.textContent = `${country.name} ${country.dialCode}. Enter the number without the international country code.`;
    }
    if (nationalInput) {
      nationalInput.placeholder = country.code === "ET" ? "912 345 678" : "National phone number";
    }
    if (feedback) {
      feedback.textContent = "";
      feedback.className = "booking-field-feedback";
    }

    state.details.phoneCountryCode = country.code;
  } else {
    const searchInput = document.querySelector("[data-nationality-input]");
    const countryCodeInput = document.querySelector("[name='nationalityCountryCode']");
    const nationalityInput = document.querySelector("[name='nationality']");
    const flag = document.querySelector("[data-nationality-flag]");
    const feedback = document.querySelector("[data-nationality-feedback]");

    if (searchInput) {
      searchInput.value = country.name;
      searchInput.setAttribute("aria-invalid", "false");
    }
    if (countryCodeInput) {
      countryCodeInput.value = country.code;
    }
    if (nationalityInput) {
      nationalityInput.value = country.name;
    }
    if (flag) {
      flag.textContent = countryFlag(country.code);
    }
    if (feedback) {
      feedback.textContent = `Selected: ${country.name}`;
      feedback.className = "booking-field-feedback is-success";
    }

    state.details.nationalityCountryCode = country.code;
    state.details.nationality = country.name;
    state.details.nationalitySearch = country.name;
  }

  setCountryMenuOpen(target, false);
}

function updateEmailFeedback(input) {
  const feedback = document.querySelector("[data-email-feedback]");
  if (!input || !feedback) {
    return;
  }

  if (!input.value.trim()) {
    input.setCustomValidity("");
    input.removeAttribute("aria-invalid");
    feedback.textContent = "";
    feedback.className = "booking-field-feedback";
    return;
  }

  const result = emailValidation(input.value);
  input.setCustomValidity(result.message);
  input.setAttribute("aria-invalid", String(Boolean(result.message)));
  feedback.textContent = result.message || "Email format looks valid.";
  feedback.className = `booking-field-feedback ${result.message ? "is-error" : "is-success"}`;
}

function updatePhoneFeedback() {
  const input = document.querySelector("[name='phoneNationalNumber']");
  const countryCode = document.querySelector("[name='phoneCountryCode']")?.value;
  const country = findCountry(countryCode);
  const feedback = document.querySelector("[data-phone-feedback]");
  if (!input || !country || !feedback) {
    return;
  }

  const nationalNumber = nationalPhoneForCountry(input.value, country);
  if (!nationalNumber) {
    feedback.textContent = "";
    feedback.className = "booking-field-feedback";
    input.removeAttribute("aria-invalid");
    return;
  }

  const isValid =
    nationalNumber.length >= country.minDigits &&
    nationalNumber.length <= country.maxDigits &&
    `${country.dialCode}${nationalNumber}`.replace(/\D/g, "").length <= 15;
  input.setAttribute("aria-invalid", String(!isValid));
  feedback.textContent = isValid
    ? `International number: ${formatInternationalPhone(country, nationalNumber)}`
    : `Check the ${country.name} number length before continuing.`;
  feedback.className = `booking-field-feedback ${isValid ? "is-success" : "is-error"}`;
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
  document
    .querySelector("[data-start-chapa-checkout]")
    ?.addEventListener("click", startChapaCheckout);
  document
    .querySelector("[data-retry-international-quote]")
    ?.addEventListener("click", loadInternationalQuote);

  const emailInput = document.querySelector("[name='email']");
  emailInput?.addEventListener("input", () => updateEmailFeedback(emailInput));
  emailInput?.addEventListener("blur", () => updateEmailFeedback(emailInput));

  document.querySelector("[data-country-trigger='phone']")?.addEventListener("click", () => {
    const menu = document.querySelector("[data-country-menu='phone']");
    const shouldOpen = Boolean(menu?.hidden);
    closeCountryMenus("phone");
    setCountryMenuOpen("phone", shouldOpen);
  });

  document.querySelector("[data-country-search-input='phone']")?.addEventListener("input", (event) => {
    filterCountryOptions("phone", event.target.value);
  });

  const nationalityInput = document.querySelector("[data-nationality-input]");
  nationalityInput?.addEventListener("focus", () => {
    closeCountryMenus("nationality");
    setCountryMenuOpen("nationality", true);
    filterCountryOptions("nationality", nationalityInput.value);
  });
  nationalityInput?.addEventListener("input", () => {
    const countryCodeInput = document.querySelector("[name='nationalityCountryCode']");
    const nationalityValue = document.querySelector("[name='nationality']");
    const feedback = document.querySelector("[data-nationality-feedback]");
    const flag = document.querySelector("[data-nationality-flag]");
    if (countryCodeInput) {
      countryCodeInput.value = "";
    }
    if (nationalityValue) {
      nationalityValue.value = "";
    }
    if (flag) {
      flag.textContent = "◎";
    }
    if (feedback) {
      feedback.textContent = "Select a matching country from the list.";
      feedback.className = "booking-field-feedback";
    }
    nationalityInput.setAttribute("aria-invalid", "true");
    setCountryMenuOpen("nationality", true);
    filterCountryOptions("nationality", nationalityInput.value);
  });

  document.querySelectorAll("[data-country-option]").forEach((option) => {
    option.addEventListener("click", () => {
      selectCountryOption(option.dataset.countryOption, option.dataset.countryCode);
    });
  });

  const phoneInput = document.querySelector("[name='phoneNationalNumber']");
  phoneInput?.addEventListener("input", updatePhoneFeedback);
  phoneInput?.addEventListener("blur", updatePhoneFeedback);

  if (!countryDismissBound) {
    document.addEventListener("click", (event) => {
      if (!event.target.closest("[data-country-combobox]")) {
        closeCountryMenus();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeCountryMenus();
      }
    });
    countryDismissBound = true;
  }

  document.querySelector("[name='governmentId']")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    const fileName = document.querySelector("[data-government-id-file-name]");
    const uploadStatus = document.querySelector("[data-government-id-status]");
    const validationMessage = validateGovernmentIdFile(file);

    if (fileName) {
      fileName.textContent = file?.name || "No file selected yet";
    }

    if (uploadStatus) {
      uploadStatus.classList.toggle("is-error", Boolean(validationMessage));
      uploadStatus.classList.toggle("is-success", Boolean(file?.name && !validationMessage));
      uploadStatus.textContent =
        validationMessage ||
        "ID file is ready for secure upload when you submit payment.";
    }
  });

  document.querySelector("[name='paymentProof']")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    const fileStatus = document.querySelector("[data-payment-proof-file]");
    if (!fileStatus) {
      return;
    }

    if (!file?.name) {
      fileStatus.textContent = "No payment proof selected yet.";
      fileStatus.className = "";
      return;
    }

    const validationMessage = validatePaymentProof(
      file,
      !nationalityIsEthiopian(),
    );

    fileStatus.textContent = validationMessage
      ? validationMessage
      : `${file.name} is ready for secure upload.`;
    fileStatus.className = validationMessage ? "is-error" : "is-success";
  });

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
