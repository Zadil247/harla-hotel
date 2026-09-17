import { Navbar } from "./components.js?v=20260916-v1-room-inventory-authority";
import { images, siteConfig } from "./data.js?v=20260916-v1-room-inventory-authority";
import { requireRoomAdminAccess, roomAdminRequest } from "./room-api.js?v=20260916-v1-room-inventory-authority";
import {
  backendSetupMessage,
  isBackendReady,
  signOutAdmin,
} from "./supabase-api.js?v=20260916-v1-room-inventory-authority";

const app = document.querySelector("#admin-app");
const authTimeoutMs = 18_000;
let latestRoomBookings = [];
let adminNotice = "";

function ethiopiaDateOffset(days = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Addis_Ababa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const source = new Date(`${values.year}-${values.month}-${values.day}T00:00:00Z`);
  source.setUTCDate(source.getUTCDate() + days);
  return source.toISOString().slice(0, 10);
}

let availabilityRange = {
  checkIn: ethiopiaDateOffset(0),
  checkOut: ethiopiaDateOffset(1),
};

const pendingStatuses = new Set([
  "pending",
  "pending_review",
  "pending_payment_review",
  "pending_payment_confirmation",
]);
const confirmedStatuses = new Set(["approved", "confirmed", "checked_in"]);
const inactiveStatuses = new Set(["declined", "rejected", "cancelled", "checked_out"]);
const inventoryBlockingStatuses = new Set([
  ...pendingStatuses,
  "approved",
  "confirmed",
  "checked_in",
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value, includeTime = false) {
  if (!value) return "-";
  const source = String(value).includes("T") ? new Date(value) : new Date(`${value}T12:00:00+03:00`);
  return new Intl.DateTimeFormat("en-ET", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" } : {}),
    timeZone: "Africa/Addis_Ababa",
  }).format(source);
}

function formatMoney(booking) {
  const currency = booking.payment_currency || "ETB";
  const value = currency === "USD"
    ? Number(booking.total_price_usd || 0)
    : Number(booking.total_price_etb ?? booking.total_price ?? 0);
  return value > 0
    ? `${value.toLocaleString("en-US", { minimumFractionDigits: currency === "USD" ? 2 : 0 })} ${currency}`
    : "-";
}

function humanize(value) {
  const text = String(value || "-").replaceAll("_", " ");
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function withTimeout(promise, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), authTimeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function statusPill(status) {
  return `<span class="status-pill status-${escapeHtml(status)}">${escapeHtml(humanize(status))}</span>`;
}

function secureDocument(url, label, path = "") {
  if (!url) return path ? "Secure document unavailable - refresh to retry." : "-";
  const isImage = /\.(png|jpe?g|webp)(?:$|\?)/i.test(path);
  return `
    <a class="admin-screenshot-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">
      ${isImage ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" loading="lazy" />` : ""}
      <span>Open ${escapeHtml(label)}</span>
    </a>
  `;
}

function inventoryHoldLabel(booking) {
  return booking.inventory_hold_active
    ? `<span class="inventory-hold-pill is-holding">Holding Room</span>`
    : `<span class="inventory-hold-pill is-released">Released${booking.inventory_release_type === "manual_override" ? " by Admin" : ""}</span>`;
}

function inventoryAuthorityActions(booking) {
  if (!inventoryBlockingStatuses.has(booking.status)) return "";
  if (booking.inventory_hold_active) {
    return `
      <button class="status-action status-action-warning" type="button" data-room-transition="force_release" data-room-id="${booking.id}">
        Force Release Inventory
      </button>
    `;
  }
  return `
    <button class="status-action" type="button" data-room-transition="restore_hold" data-room-id="${booking.id}">
      Restore Inventory Hold
    </button>
  `;
}

function roomBookingActions(booking, group) {
  const contactButton = booking.customer_contacted
    ? `<button class="status-action is-current" type="button" disabled>Customer Contacted</button>`
    : `<button class="status-action" type="button" data-room-contacted="${booking.id}">Mark Customer Contacted</button>`;

  if (group === "pending") {
    return `
      <div class="admin-actions">
        ${booking.inventory_hold_active
          ? `<button class="status-action" type="button" data-room-transition="confirm" data-room-id="${booking.id}">Approve Booking</button>`
          : ""}
        <button class="status-action" type="button" data-room-transition="decline" data-room-id="${booking.id}">Decline Booking</button>
        ${inventoryAuthorityActions(booking)}
        ${contactButton}
      </div>
    `;
  }
  if (group === "confirmed") {
    return `
      <div class="admin-actions">
        ${["approved", "confirmed"].includes(booking.status) && booking.inventory_hold_active
          ? `<button class="status-action" type="button" data-room-transition="check_in" data-room-id="${booking.id}">Mark Checked In</button>`
          : ""}
        ${["approved", "confirmed", "checked_in"].includes(booking.status)
          ? `<button class="status-action" type="button" data-room-transition="check_out" data-room-id="${booking.id}">Check Out &amp; Release Room</button>`
          : ""}
        ${inventoryAuthorityActions(booking)}
        <button class="status-action" type="button" data-room-pdf="${booking.id}">Download Confirmation PDF</button>
        <button class="status-action" type="button" data-room-resend="${booking.id}">Resend Confirmation Email</button>
        ${contactButton}
      </div>
    `;
  }
  if (booking.status === "checked_out") {
    return `
      <div class="admin-actions">
        <button class="status-action" type="button" data-room-pdf="${booking.id}">Download Confirmation PDF</button>
        <button class="status-action" type="button" data-room-resend="${booking.id}">Resend Confirmation Email</button>
        ${contactButton}
      </div>
    `;
  }
  return `<div class="admin-actions">${contactButton}</div>`;
}

function roomBookingCard(booking, group) {
  return `
    <article class="admin-order-card">
      <div class="admin-order-card-head">
        <div>
          <p class="eyebrow">${escapeHtml(booking.booking_number || "No booking reference")}</p>
          <h3>${escapeHtml(booking.full_name)}</h3>
        </div>
        <div class="room-admin-state-pills">
          ${statusPill(booking.status)}
          ${inventoryHoldLabel(booking)}
        </div>
      </div>
      <dl class="admin-order-details">
        <div><dt>Email</dt><dd>${escapeHtml(booking.email || "-")}</dd></div>
        <div><dt>Phone</dt><dd>${escapeHtml(booking.phone || "-")}</dd></div>
        <div><dt>Date of birth</dt><dd>${formatDate(booking.date_of_birth)}</dd></div>
        <div><dt>Nationality</dt><dd>${escapeHtml(booking.nationality || "-")}</dd></div>
        <div><dt>Room type</dt><dd>${escapeHtml(booking.room_type || booking.room_name || "-")}</dd></div>
        <div><dt>Number of rooms</dt><dd>${escapeHtml(booking.number_of_rooms || 1)}</dd></div>
        <div><dt>Check-in</dt><dd>${formatDate(booking.check_in)}</dd></div>
        <div><dt>Check-out</dt><dd>${formatDate(booking.check_out)}</dd></div>
        <div><dt>Nights</dt><dd>${escapeHtml(booking.nights || "-")}</dd></div>
        <div><dt>Guests</dt><dd>${escapeHtml(booking.guests || "-")}</dd></div>
        <div><dt>Total</dt><dd>${escapeHtml(formatMoney(booking))}</dd></div>
        <div><dt>Payment method</dt><dd>${escapeHtml(booking.payment_method || "-")}</dd></div>
        <div><dt>Payment reference</dt><dd>${escapeHtml(booking.payment_reference || "-")}</dd></div>
        <div><dt>Payment status</dt><dd>${escapeHtml(humanize(booking.payment_status))}</dd></div>
        <div><dt>Payment proof</dt><dd>${secureDocument(booking.payment_screenshot_display_url, "payment proof", booking.payment_screenshot_url)}</dd></div>
        <div><dt>Government ID</dt><dd>${secureDocument(booking.government_id_display_url, "government ID", booking.government_id_path)}</dd></div>
        ${booking.decline_reason ? `<div><dt>Decision reason</dt><dd>${escapeHtml(booking.decline_reason)}</dd></div>` : ""}
        ${booking.confirmed_at ? `<div><dt>Confirmed</dt><dd>${formatDate(booking.confirmed_at, true)}</dd></div>` : ""}
        ${booking.actual_check_in_at ? `<div><dt>Actual check-in</dt><dd>${formatDate(booking.actual_check_in_at, true)}</dd></div>` : ""}
        ${booking.actual_check_out_at ? `<div><dt>Actual check-out</dt><dd>${formatDate(booking.actual_check_out_at, true)}</dd></div>` : ""}
        ${!booking.inventory_hold_active ? `
          <div><dt>Inventory released</dt><dd>${formatDate(booking.inventory_released_at, true)}</dd></div>
          <div><dt>Release type</dt><dd>${escapeHtml(humanize(booking.inventory_release_type))}</dd></div>
          <div><dt>Release reason</dt><dd>${escapeHtml(booking.inventory_release_reason || "-")}</dd></div>
          <div><dt>Released by</dt><dd>${escapeHtml(
            booking.inventory_release_admin?.full_name
              || booking.inventory_release_admin?.email
              || (booking.inventory_released_by ? "Authorized Room Admin" : "Legacy/system transition"),
          )}</dd></div>
          ${booking.inventory_released_by_role ? `<div><dt>Admin role</dt><dd>${escapeHtml(humanize(booking.inventory_released_by_role))}</dd></div>` : ""}
        ` : ""}
        <div><dt>Email status</dt><dd>${escapeHtml(humanize(booking.email_status || "not sent"))}</dd></div>
        <div><dt>Customer contacted</dt><dd>${booking.customer_contacted ? "Yes" : "No"}</dd></div>
        <div><dt>Created</dt><dd>${formatDate(booking.created_at, true)}</dd></div>
      </dl>
      ${roomBookingActions(booking, group)}
    </article>
  `;
}

function inventoryPanel(inventory = [], availability = [], range = availabilityRange) {
  const dateAvailability = new Map(
    availability.map((room) => [String(room.room_type || "").toLowerCase(), room]),
  );
  return `
    <section class="admin-card room-inventory-admin-card">
      <div class="admin-panel-heading compact-heading">
        <div>
          <p class="eyebrow">Room Inventory</p>
          <h2>Base Sellable Capacity</h2>
          <p>Date-specific availability is calculated from this capacity minus overlapping active bookings.</p>
        </div>
      </div>
      <form class="room-availability-admin-form" data-room-availability-form>
        <label>Check-in<input name="checkIn" type="date" value="${escapeHtml(range.checkIn)}" min="${escapeHtml(ethiopiaDateOffset(0))}" required /></label>
        <label>Check-out<input name="checkOut" type="date" value="${escapeHtml(range.checkOut)}" min="${escapeHtml(ethiopiaDateOffset(1))}" required /></label>
        <button class="btn btn-primary" type="submit">Check Date Availability</button>
      </form>
      <div class="room-inventory-admin-grid">
        ${inventory.map((room) => {
          const dateRoom = dateAvailability.get(String(room.room_type || "").toLowerCase());
          return `
          <article class="room-inventory-admin-form">
            <h3>${escapeHtml(room.room_type)}</h3>
            <dl class="room-capacity-summary">
              <div><dt>Total Physical Rooms</dt><dd>${escapeHtml(dateRoom?.total_rooms ?? room.total_rooms)}</dd></div>
              <div><dt>Sellable Capacity</dt><dd>${escapeHtml(dateRoom?.sellable_rooms ?? room.sellable_rooms ?? room.total_rooms)}</dd></div>
              <div><dt>Active Holds for Selected Dates</dt><dd>${escapeHtml(dateRoom?.held_rooms ?? "-")}</dd></div>
              <div><dt>Available for Selected Dates</dt><dd>${escapeHtml(dateRoom?.available_rooms ?? "-")}</dd></div>
            </dl>
            <form class="room-capacity-edit-form" data-room-inventory-form="${escapeHtml(room.id)}">
              <label>Total physical rooms<input name="totalRooms" type="number" min="0" value="${escapeHtml(room.total_rooms)}" required /></label>
              <label>Sellable rooms<input name="sellableRooms" type="number" min="0" max="${escapeHtml(room.total_rooms)}" value="${escapeHtml(room.sellable_rooms ?? room.total_rooms)}" required /></label>
              <button class="btn btn-light" type="submit">Update Base Capacity</button>
            </form>
          </article>
        `;}).join("")}
      </div>
    </section>
  `;
}

function bookingSection(bookings = [], inventory = [], availability = [], range = availabilityRange) {
  const pending = bookings.filter((booking) => pendingStatuses.has(booking.status));
  const confirmed = bookings.filter((booking) => confirmedStatuses.has(booking.status));
  const inactive = bookings.filter((booking) => inactiveStatuses.has(booking.status));
  const panel = (eyebrow, title, rows, group, empty) => `
    <section class="admin-panel" ${group === "confirmed" ? 'id="approved-orders"' : ""}>
      <div class="admin-panel-heading">
        <div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2></div>
        <span>${rows.length} ${group}</span>
      </div>
      <div class="admin-order-grid">
        ${rows.length ? rows.map((booking) => roomBookingCard(booking, group)).join("") : `<p class="empty-state">${empty}</p>`}
      </div>
    </section>
  `;

  return `
    ${inventoryPanel(inventory, availability, range)}
    ${panel("Pending Requests", "Pending Room Requests", pending, "pending", "No pending room requests.")}
    ${panel("Confirmed Stays", "Confirmed Room Bookings", confirmed, "confirmed", "No confirmed room bookings yet.")}
    ${panel("Released Capacity", "Checked Out, Declined & Cancelled", inactive, "inactive", "No checked-out, declined, or cancelled room requests.")}
  `;
}

function dashboardShell(content) {
  app.innerHTML = `
    ${Navbar("admin")}
    <main class="admin-shell" id="admin-main">
      <section class="admin-hero">
        <div>
          <p class="eyebrow">Room Admin</p>
          <h1>Harla Hotel Room Bookings</h1>
          <p>Review room requests, verify payment evidence, manage date-aware capacity, and issue official confirmations.</p>
        </div>
        <img src="${images.logo}" alt="${siteConfig.brandName} logo" />
      </section>

      ${content}
    </main>
  `;
  document.querySelector("[data-header]")?.classList.add("is-scrolled");
  wireNav();
}

function wireNav() {
  const toggle = document.querySelector("[data-nav-toggle]");
  const menu = document.querySelector("[data-nav-menu]");
  toggle?.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    menu?.classList.toggle("is-open");
  });
}

function redirectToLogin(message = "") {
  const loginUrl = new URL("./admin-login.html", window.location.href);
  loginUrl.searchParams.set("next", "admin.html");
  if (message) loginUrl.searchParams.set("message", message);
  window.location.replace(loginUrl.toString());
}

function setupNotice() {
  dashboardShell(`<section class="admin-card"><h2>Connect Supabase</h2><p>${escapeHtml(backendSetupMessage())}</p></section>`);
}

async function renderDashboard(adminProfile) {
  try {
    const data = await withTimeout(
      roomAdminRequest("dashboard", availabilityRange),
      "The Room Admin service did not respond while loading bookings.",
    );
    latestRoomBookings = data.bookings || [];
    const pendingCount = latestRoomBookings.filter((item) => pendingStatuses.has(item.status)).length;
    dashboardShell(`
      <section class="admin-toolbar">
        <div><strong>${pendingCount}</strong><span>pending room requests</span></div>
        <span class="admin-user">${escapeHtml(adminProfile.full_name || adminProfile.email)}</span>
        <button class="btn btn-light" type="button" id="admin-refresh">Refresh</button>
        <button class="btn btn-primary" type="button" id="admin-sign-out">Sign Out</button>
      </section>
      ${adminNotice ? `<section class="admin-card admin-notice" role="status"><p>${escapeHtml(adminNotice)}</p></section>` : ""}
      ${bookingSection(
        latestRoomBookings,
        data.inventory || [],
        data.availability || [],
        data.availabilityRange || availabilityRange,
      )}
      <p class="admin-status" role="status" aria-live="polite"></p>
    `);
    adminNotice = "";
    bindActions(adminProfile);
  } catch (error) {
    dashboardShell(`
      <section class="admin-toolbar"><span class="admin-user">${escapeHtml(adminProfile.full_name || adminProfile.email)}</span><button class="btn btn-light" id="admin-refresh">Refresh</button><button class="btn btn-primary" id="admin-sign-out">Sign Out</button></section>
      <section class="admin-card"><h2>Room dashboard could not load</h2><p>${escapeHtml(error.message || "Could not load room bookings.")}</p></section>
      <p class="admin-status" role="status" aria-live="polite"></p>
    `);
    bindActions(adminProfile);
  }
}

function openSecureUrl(url) {
  if (!url) throw new Error("The secure document URL was not returned.");
  window.open(url, "_blank", "noopener,noreferrer");
}

function bindActions(adminProfile) {
  document.querySelector("#admin-refresh")?.addEventListener("click", () => renderDashboard(adminProfile));
  document.querySelector("#admin-sign-out")?.addEventListener("click", async () => {
    await signOutAdmin();
    redirectToLogin("signed-out");
  });

  document.querySelectorAll("[data-room-transition]").forEach((button) => {
    button.addEventListener("click", async () => {
      const status = document.querySelector(".admin-status");
      const transition = button.dataset.roomTransition;
      let reason = "";
      if (transition === "decline") {
        reason = window.prompt("Reason shown to the guest (required):", "The requested room is unavailable for these dates.") || "";
        if (!reason.trim()) return;
      }
      if (transition === "force_release") {
        const approved = window.confirm(
          "Release this booking's room inventory? The public booking website may immediately sell this capacity even if the guest is still occupying the room.",
        );
        if (!approved) return;
        reason = window.prompt("Management reason for releasing this inventory (required):", "") || "";
        if (!reason.trim()) return;
      }
      if (transition === "restore_hold") {
        reason = window.prompt(
          "Reason for restoring this booking's room inventory hold (required):",
          "Room inventory hold restored by management.",
        ) || "";
        if (!reason.trim()) return;
      }
      if (transition === "check_out" && !window.confirm(
        "Check out this guest and release the room inventory now? The original booking dates will remain unchanged.",
      )) return;
      try {
        button.disabled = true;
        const progressMessages = {
          confirm: "Confirming the held booking and preparing the official confirmation...",
          decline: "Declining the request and releasing its date hold...",
          check_in: "Marking the guest as checked in...",
          check_out: "Checking out the guest and releasing room inventory...",
          force_release: "Applying the management inventory release...",
          restore_hold: "Restoring the inventory hold after a final capacity check...",
        };
        status.textContent = progressMessages[transition] || "Updating this booking...";
        const result = await roomAdminRequest("transition", {
          bookingId: button.dataset.roomId,
          transition,
          reason,
        });
        if (transition === "confirm") {
          adminNotice = result.confirmation?.error
            ? `Booking confirmed, but the official PDF needs attention: ${result.confirmation.error}`
            : result.email?.sent
              ? "Booking confirmed. The official stamped PDF was stored and emailed to the guest."
              : `Booking confirmed and the official PDF was stored. Email needs attention: ${result.email?.error || "not sent"}`;
        } else {
          const notices = {
            decline: "Booking declined. Its room capacity is immediately available for those dates.",
            check_in: "Guest marked as checked in. The existing room inventory hold remains active.",
            check_out: "Guest checked out. Room inventory is immediately available for overlapping dates.",
            force_release: "Inventory released by management. The booking status and contractual dates were not changed.",
            restore_hold: "Inventory hold restored after a successful date-capacity check.",
          };
          adminNotice = notices[transition] || "Room booking updated.";
        }
        await renderDashboard(adminProfile);
      } catch (error) {
        button.disabled = false;
        status.textContent = error.message || "Could not update this room booking.";
      }
    });
  });

  document.querySelector("[data-room-availability-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector(".admin-status");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (!values.checkIn || !values.checkOut || values.checkOut <= values.checkIn) {
      status.textContent = "Check-out must be after check-in.";
      return;
    }
    availabilityRange = { checkIn: values.checkIn, checkOut: values.checkOut };
    status.textContent = "Loading date-aware room availability...";
    await renderDashboard(adminProfile);
  });

  document.querySelectorAll("[data-room-contacted]").forEach((button) => {
    button.addEventListener("click", async () => {
      const status = document.querySelector(".admin-status");
      try {
        await roomAdminRequest("contacted", { bookingId: button.dataset.roomContacted });
        await renderDashboard(adminProfile);
      } catch (error) {
        status.textContent = error.message || "Could not mark this guest as contacted.";
      }
    });
  });

  document.querySelectorAll("[data-room-pdf]").forEach((button) => {
    button.addEventListener("click", async () => {
      const status = document.querySelector(".admin-status");
      try {
        status.textContent = "Opening the stored official confirmation...";
        const result = await roomAdminRequest("confirmation", { bookingId: button.dataset.roomPdf });
        openSecureUrl(result.confirmation?.signedUrl);
        status.textContent = "Official confirmation opened in a secure tab.";
      } catch (error) {
        status.textContent = error.message || "Could not open the room confirmation.";
      }
    });
  });

  document.querySelectorAll("[data-room-resend]").forEach((button) => {
    button.addEventListener("click", async () => {
      const status = document.querySelector(".admin-status");
      try {
        button.disabled = true;
        status.textContent = "Resending the official confirmation email...";
        await roomAdminRequest("resend_confirmation", { bookingId: button.dataset.roomResend });
        adminNotice = "The stored official confirmation was emailed again.";
        await renderDashboard(adminProfile);
      } catch (error) {
        button.disabled = false;
        status.textContent = error.message || "Could not resend the confirmation email.";
      }
    });
  });

  document.querySelectorAll("[data-room-inventory-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = document.querySelector(".admin-status");
      try {
        await roomAdminRequest("inventory", {
          inventoryId: form.dataset.roomInventoryForm,
          values: Object.fromEntries(new FormData(form).entries()),
        });
        adminNotice = "Room base sellable capacity updated.";
        await renderDashboard(adminProfile);
      } catch (error) {
        status.textContent = error.message || "Could not update room capacity.";
      }
    });
  });
}

async function initAdmin() {
  if (!isBackendReady()) {
    setupNotice();
    return;
  }
  dashboardShell(`<section class="admin-card"><h2>Loading Room Admin...</h2><p>Checking your room-admin session and loading room bookings.</p></section>`);
  try {
    const profile = await withTimeout(
      requireRoomAdminAccess(),
      "The Room Admin service did not respond while checking access.",
    );
    await renderDashboard(profile);
  } catch (error) {
    await signOutAdmin().catch(() => {});
    redirectToLogin(error.message || "login-required");
  }
}

initAdmin();
