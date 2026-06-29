import { App } from "./components.js?v=20260521-room-automation";
import { siteConfig } from "./data.js?v=20260521-room-automation";
import { initImageLightbox } from "./lightbox.js?v=20260521-room-automation";
import {
  backendSetupMessage,
  createEventRequest,
  createPackageBooking,
  createRestaurantRequest,
  getRoomInventory,
  isBackendReady,
  subscribeRoomInventory,
} from "./supabase-api.js?v=20260521-room-automation";

const app = document.querySelector("#app");
app.innerHTML = App();

const header = document.querySelector("[data-header]");
const navToggle = document.querySelector("[data-nav-toggle]");
const navMenu = document.querySelector("[data-nav-menu]");
const bookingForm = document.querySelector("#booking-form");
const serviceType = document.querySelector("#service-type");
const packageName = document.querySelector("#package-name");
const roomType = document.querySelector("#room-type");
const hotelFields = document.querySelectorAll("[data-hotel-field]");
const eventFields = document.querySelectorAll("[data-event-field]");
const packageFields = document.querySelectorAll("[data-package-field]");
const roomFields = document.querySelectorAll("[data-room-field]");

function setHeaderState() {
  header.classList.toggle("is-scrolled", window.scrollY > 20);
}

function closeMenu() {
  navToggle.setAttribute("aria-expanded", "false");
  navMenu.classList.remove("is-open");
}

function updateConditionalFields() {
  const selected = serviceType.value;
  hotelFields.forEach((field) => {
    field.hidden = selected !== "Hotel booking only" && selected !== "Hotel + tour package";
  });
  roomFields.forEach((field) => {
    field.hidden = selected !== "Hotel booking only" && selected !== "Hotel + tour package";
  });
  eventFields.forEach((field) => {
    field.hidden =
      selected !== "Event hall booking" && selected !== "Cultural Photo & Lunch Room booking";
  });
  packageFields.forEach((field) => {
    field.hidden = selected !== "Hotel + tour package" && selected !== "Custom package request";
  });
}

function roomAvailabilityPercent(room) {
  const total = Number(room.total_rooms || 0);
  const available = Number(room.available_rooms || 0);
  if (!total) {
    return 0;
  }
  return Math.max(0, Math.min(100, (available / total) * 100));
}

function renderRoomAvailability(inventory) {
  document.querySelectorAll("[data-availability-card]").forEach((card) => {
    const room = inventory.find((item) => item.room_type === card.dataset.availabilityCard);
    if (!room) {
      return;
    }

    const available = Number(room.available_rooms || 0);
    const total = Number(room.total_rooms || 0);
    card.querySelector("[data-availability-text]").textContent = `Available: ${available} out of ${total}`;
    card.querySelector("[data-availability-fill]").style.width = `${roomAvailabilityPercent(room)}%`;
  });
}

async function loadRoomAvailability() {
  const status = document.querySelector("[data-room-availability-status]");
  if (!status) {
    return;
  }

  if (!isBackendReady()) {
    status.textContent = backendSetupMessage();
    return;
  }

  try {
    renderRoomAvailability(await getRoomInventory());
    status.textContent = "";
  } catch (error) {
    status.textContent = error.message || "Could not load room availability.";
  }
}

function setServiceShortcut(service, packageDeal = "", room = "") {
  serviceType.value = service;
  if (packageDeal && packageName) {
    packageName.value = packageDeal;
  }
  if (room && roomType) {
    roomType.value = room;
  }
  updateConditionalFields();
  bookingForm.querySelector("[name='fullName']").focus({ preventScroll: true });
}

navToggle.addEventListener("click", () => {
  const expanded = navToggle.getAttribute("aria-expanded") === "true";
  navToggle.setAttribute("aria-expanded", String(!expanded));
  navMenu.classList.toggle("is-open");
});

document.querySelectorAll("[data-nav-menu] a").forEach((link) => {
  link.addEventListener("click", closeMenu);
});

document.querySelectorAll("[data-service-shortcut]").forEach((button) => {
  button.addEventListener("click", () =>
    setServiceShortcut(
      button.dataset.serviceShortcut,
      button.dataset.packageShortcut,
      button.dataset.roomShortcut,
    ),
  );
});

serviceType.addEventListener("change", updateConditionalFields);
window.addEventListener("scroll", setHeaderState, { passive: true });

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

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(bookingForm);
  const inquiry = Object.fromEntries(formData.entries());
  const status = bookingForm.querySelector(".form-status");

  if (!inquiry.fullName?.trim() || !inquiry.phone?.trim()) {
    status.textContent = "Please enter your full name and phone number.";
    return;
  }

  if (inquiry.serviceType === "Hotel booking only") {
    status.innerHTML = 'Please use the dedicated <a class="text-link" href="./book-room.html">room booking page</a> for room prices and totals.';
    return;
  }

  if (!isBackendReady()) {
    console.info("Harla Hotel booking inquiry", {
      endpoint: siteConfig.bookingEndpoint,
      inquiry,
    });
    status.textContent = backendSetupMessage();
    return;
  }

  try {
    status.textContent = "Sending your request...";

    if (
      inquiry.serviceType === "Restaurant reservation" ||
      inquiry.serviceType === "VIP Private Room reservation"
    ) {
      await createRestaurantRequest(inquiry);
    } else if (
      inquiry.serviceType === "Event hall booking" ||
      inquiry.serviceType === "Cultural Photo & Lunch Room booking"
    ) {
      await createEventRequest(inquiry);
    } else {
      await createPackageBooking(inquiry);
    }

    status.textContent = "Thank you. Your request was saved and is pending review.";
    bookingForm.reset();
    updateConditionalFields();
  } catch (error) {
    status.textContent = error.message || "Sorry, we could not send your request. Please try WhatsApp.";
  }
});

setHeaderState();
updateConditionalFields();
loadRoomAvailability();

if (isBackendReady()) {
  subscribeRoomInventory(renderRoomAvailability).catch(() => {});
  window.setInterval(loadRoomAvailability, 30_000);
}
