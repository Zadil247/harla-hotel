import { Navbar } from "./components.js?v=20260521-room-automation";
import { images, siteConfig } from "./data.js?v=20260521-room-automation";
import {
  backendSetupMessage,
  getAdminDashboardData,
  isBackendReady,
  markRoomBookingContacted,
  markRestaurantOrderEnteredInOdoo,
  requireAdminAccess,
  signOutAdmin,
  updateRoomBookingStatus,
  updateRoomInventory,
  updateRequestStatus,
  updateRestaurantOrderStatus,
  updateRestaurantSettings,
} from "./supabase-api.js?v=20260521-room-automation";

const app = document.querySelector("#admin-app");
const authTimeoutMs = 18000;
const defaultRestaurantSettings = {
  id: "default",
  ordering_available: true,
  custom_message: "",
};
let latestRoomBookings = [];

const requestSections = [
  {
    key: "eventRequests",
    table: "event_requests",
    title: "Event Hall Requests",
    columns: [
      ["Guest", "full_name"],
      ["Phone", "phone"],
      ["Type", "service_type"],
      ["Event", "event_type"],
      ["Date", "event_date"],
      ["Guests", "guests"],
      ["Catering", "catering_package"],
    ],
  },
  {
    key: "restaurantRequests",
    table: "restaurant_requests",
    title: "Restaurant Requests",
    columns: [
      ["Guest", "full_name"],
      ["Phone", "phone"],
      ["Type", "service_type"],
      ["Date", "reservation_date"],
      ["Time", "reservation_time"],
      ["Guests", "guests"],
    ],
  },
  {
    key: "packageBookings",
    table: "package_bookings",
    title: "Package Bookings",
    columns: [
      ["Guest", "full_name"],
      ["Phone", "phone"],
      ["Type", "service_type"],
      ["Package", "package_name"],
      ["Check-in", "check_in"],
      ["Guests", "guests"],
    ],
  },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatEtb(value) {
  return `${new Intl.NumberFormat("en-US").format(Number(value || 0))} ETB`;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-ET", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function withTimeout(promise, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), authTimeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function statusPill(status) {
  return `<span class="status-pill status-${escapeHtml(status)}">${escapeHtml(status || "-")}</span>`;
}

function formatJsonList(value) {
  const items = Array.isArray(value) ? value : [];

  if (!items.length) {
    return "-";
  }

  return `
    <ul class="admin-line-list">
      ${items
        .map((item) => {
          if ("kilograms" in item) {
            return `<li>${escapeHtml(item.name)}: ${escapeHtml(item.kilograms)} kg, ${escapeHtml(item.level)}</li>`;
          }
          return `<li>${escapeHtml(item.quantity)} x ${escapeHtml(item.name)}${item.line_total ? ` (${formatEtb(item.line_total)})` : ""}</li>`;
        })
        .join("")}
    </ul>
  `;
}

function formatValue(key, value, row) {
  if (key === "total_price") {
    return formatEtb(value);
  }

  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return escapeHtml(value);
}

function screenshotPreview(order) {
  const url = order.payment_screenshot_display_url;

  if (!url && !order.payment_screenshot_url) {
    return "-";
  }

  if (!url) {
    return escapeHtml(order.payment_screenshot_url);
  }

  return `
    <a class="admin-screenshot-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">
      <img src="${escapeHtml(url)}" alt="Payment screenshot" loading="lazy" />
      <span>Open screenshot</span>
    </a>
  `;
}

function orderAddress(order) {
  if (order.order_type !== "Delivery") {
    return "-";
  }

  return order.address_area === "Other"
    ? `${escapeHtml(order.address_area)}: ${escapeHtml(order.custom_address || "")}`
    : escapeHtml(order.address_area || "-");
}

function roomBookingActions(booking, mode = "pending") {
  const contactButton = booking.customer_contacted
    ? `<button class="status-action is-current" type="button" disabled>Customer Contacted</button>`
    : `<button class="status-action" type="button" data-room-contacted="${booking.id}">Mark Customer Contacted</button>`;

  if (mode === "confirmed") {
    return `
      <div class="admin-actions">
        <button class="status-action" type="button" data-room-pdf="${booking.id}">Download PDF</button>
        ${contactButton}
      </div>
    `;
  }

  if (mode !== "pending") {
    return `<div class="admin-actions">${contactButton}</div>`;
  }

  return `
    <div class="admin-actions">
      <button class="status-action" type="button" data-room-booking-status="confirmed" data-room-booking-id="${booking.id}">Approve Booking</button>
      <button class="status-action" type="button" data-room-booking-status="declined" data-room-booking-id="${booking.id}">Decline Booking</button>
      ${contactButton}
    </div>
  `;
}

function roomBookingCard(booking, mode = "pending") {
  return `
    <article class="admin-order-card">
      <div class="admin-order-card-head">
        <div>
          <p class="eyebrow">${escapeHtml(booking.booking_number || "No booking number")}</p>
          <h3>${escapeHtml(booking.full_name)}</h3>
        </div>
        ${statusPill(booking.status)}
      </div>
      <dl class="admin-order-details">
        <div><dt>Phone</dt><dd>${escapeHtml(booking.phone)}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(booking.email || "-")}</dd></div>
        <div><dt>Room type</dt><dd>${escapeHtml(booking.room_type || booking.room_name || "-")}</dd></div>
        <div><dt>Check-in</dt><dd>${escapeHtml(booking.check_in || "-")}</dd></div>
        <div><dt>Check-out</dt><dd>${escapeHtml(booking.check_out || "-")}</dd></div>
        <div><dt>Guests</dt><dd>${escapeHtml(booking.guests || "-")}</dd></div>
        <div><dt>Payment method</dt><dd>${escapeHtml(booking.payment_method || "-")}</dd></div>
        <div><dt>Payment reference</dt><dd>${escapeHtml(booking.payment_reference || "-")}</dd></div>
        <div><dt>Payment screenshot</dt><dd>${screenshotPreview(booking)}</dd></div>
        <div><dt>Payment status</dt><dd>${escapeHtml(booking.payment_status || "-")}</dd></div>
        <div><dt>Customer contacted</dt><dd>${booking.customer_contacted ? "Yes" : "No"}</dd></div>
        <div><dt>Created</dt><dd>${formatDate(booking.created_at)}</dd></div>
      </dl>
      ${roomBookingActions(booking, mode)}
    </article>
  `;
}

function roomInventoryPanel(inventory = []) {
  return `
    <section class="admin-card room-inventory-admin-card">
      <div class="admin-panel-heading compact-heading">
        <div>
          <p class="eyebrow">Room Inventory</p>
          <h2>Manual Availability Control</h2>
        </div>
      </div>
      <div class="room-inventory-admin-grid">
        ${inventory
          .map((room) => {
            const canUpdate = Boolean(room.id);
            return `
              <form class="room-inventory-admin-form" data-room-inventory-form="${escapeHtml(room.id || "")}">
                <h3>${escapeHtml(room.room_type)}</h3>
                <label>
                  Total rooms
                  <input name="totalRooms" type="number" min="0" value="${escapeHtml(room.total_rooms)}" required />
                </label>
                <label>
                  Available rooms
                  <input name="availableRooms" type="number" min="0" value="${escapeHtml(room.available_rooms)}" required />
                </label>
                <button class="btn btn-light" type="submit" ${canUpdate ? "" : "disabled"}>${canUpdate ? "Update Availability" : "Run SQL First"}</button>
              </form>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function roomBookingsSection(bookings = [], inventory = []) {
  const pending = bookings.filter((booking) => booking.status === "pending");
  const confirmed = bookings.filter((booking) => booking.status === "confirmed");
  const declined = bookings.filter((booking) => booking.status === "declined");

  return `
    <section class="admin-room-bookings">
      ${roomInventoryPanel(inventory)}

      <section class="admin-panel">
        <div class="admin-panel-heading">
          <div>
            <p class="eyebrow">Pending Bookings</p>
            <h2>Pending Room Bookings</h2>
          </div>
          <span>${pending.length} pending</span>
        </div>
        <div class="admin-order-grid">
          ${pending.length ? pending.map((booking) => roomBookingCard(booking)).join("") : `<p class="empty-state">No pending room bookings.</p>`}
        </div>
      </section>

      <section class="admin-panel">
        <div class="admin-panel-heading">
          <div>
            <p class="eyebrow">Approved Bookings</p>
            <h2>Approved Room Bookings</h2>
          </div>
          <span>${confirmed.length} approved</span>
        </div>
        <div class="admin-order-grid">
          ${confirmed.length ? confirmed.map((booking) => roomBookingCard(booking, "confirmed")).join("") : `<p class="empty-state">No approved room bookings yet.</p>`}
        </div>
      </section>

      <section class="admin-panel">
        <div class="admin-panel-heading">
          <h2>Declined Room Bookings</h2>
          <span>${declined.length} declined</span>
        </div>
        <div class="admin-order-grid">
          ${declined.length ? declined.map((booking) => roomBookingCard(booking, "declined")).join("") : `<p class="empty-state">No declined room bookings.</p>`}
        </div>
      </section>
    </section>
  `;
}

function actionButtons(table, id, currentStatus, options = ["approved", "rejected", "pending"]) {
  return `
    <div class="admin-actions">
      ${options
        .map(
          (status) => `
            <button
              class="status-action ${currentStatus === status ? "is-current" : ""}"
              type="button"
              data-table="${table}"
              data-id="${id}"
              data-status="${status}"
            >
              ${status}
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function restaurantOrderActions(order) {
  if (order.status !== "pending") {
    return "";
  }

  return `
    <div class="admin-actions">
      <button class="status-action" type="button" data-order-status="approved" data-order-id="${order.id}">Approve</button>
      <button class="status-action" type="button" data-order-status="declined" data-order-id="${order.id}">Decline</button>
    </div>
  `;
}

function approvedOrderActions(order) {
  return `
    <div class="admin-actions admin-odoo-actions">
      <a class="btn btn-light" href="${siteConfig.odooPosUrl}" target="_blank" rel="noopener">Open Odoo POS</a>
      <button
        class="btn btn-primary"
        type="button"
        data-odoo-entered="${order.id}"
        ${order.odoo_status === "entered" ? "disabled" : ""}
      >
        ${order.odoo_status === "entered" ? "Entered in Odoo" : "Mark Entered in Odoo"}
      </button>
    </div>
  `;
}

function restaurantOrderCard(order, mode = "pending") {
  return `
    <article class="admin-order-card">
      <div class="admin-order-card-head">
        <div>
          <p class="eyebrow">${escapeHtml(order.order_number || "No order number")}</p>
          <h3>${escapeHtml(order.customer_name)}</h3>
        </div>
        ${statusPill(order.status)}
      </div>
      <dl class="admin-order-details">
        <div><dt>Phone</dt><dd>${escapeHtml(order.phone)}</dd></div>
        <div><dt>Order type</dt><dd>${escapeHtml(order.order_type)}</dd></div>
        <div><dt>Delivery address</dt><dd>${orderAddress(order)}</dd></div>
        <div><dt>Items</dt><dd>${formatJsonList(order.items)}</dd></div>
        <div><dt>Pastries</dt><dd>${formatJsonList(order.pastry_items)}</dd></div>
        <div><dt>Payment method</dt><dd>${escapeHtml(order.payment_method || "-")}</dd></div>
        <div><dt>Payment reference</dt><dd>${escapeHtml(order.payment_reference || "-")}</dd></div>
        <div><dt>Payment screenshot</dt><dd>${screenshotPreview(order)}</dd></div>
        <div><dt>Payment status</dt><dd>${escapeHtml(order.payment_status || "-")}</dd></div>
        <div><dt>Created</dt><dd>${formatDate(order.created_at)}</dd></div>
        ${
          mode === "approved"
            ? `
              <div><dt>Approved</dt><dd>${formatDate(order.approved_at)}</dd></div>
              <div><dt>Odoo status</dt><dd>${escapeHtml(order.odoo_status || "not_entered")}</dd></div>
            `
            : ""
        }
      </dl>
      ${mode === "approved" ? approvedOrderActions(order) : restaurantOrderActions(order)}
    </article>
  `;
}

function restaurantSettingsPanel(settings = defaultRestaurantSettings) {
  const normalizedSettings = { ...defaultRestaurantSettings, ...(settings || {}) };

  return `
    <section class="admin-card restaurant-settings-card">
      <div class="admin-panel-heading compact-heading">
        <div>
          <p class="eyebrow">Restaurant Availability</p>
          <h2>Ordering Settings</h2>
        </div>
        ${statusPill(normalizedSettings.ordering_available ? "available" : "unavailable")}
      </div>
      <form class="admin-settings-form" id="restaurant-settings-form">
        <label class="toggle-row">
          <input type="checkbox" name="orderingAvailable" ${normalizedSettings.ordering_available ? "checked" : ""} />
          Ordering available
        </label>
        <label>
          Custom unavailable message
          <textarea name="customMessage" rows="3" placeholder="Kitchen is closed for today.">${escapeHtml(normalizedSettings.custom_message || "")}</textarea>
        </label>
        <button class="btn btn-primary" type="submit">Save Restaurant Settings</button>
      </form>
    </section>
  `;
}

function restaurantOrdersSection(orders = [], settings = defaultRestaurantSettings) {
  const restaurantOrders = Array.isArray(orders) ? orders : [];
  const pending = restaurantOrders.filter((order) => order.status === "pending");
  const approved = restaurantOrders.filter((order) => order.status === "approved");
  const declined = restaurantOrders.filter((order) => order.status === "declined");

  return `
    <section class="admin-restaurant-orders">
      ${restaurantSettingsPanel(settings)}

      <section class="admin-panel">
        <div class="admin-panel-heading">
          <div>
            <p class="eyebrow">Pending Orders First</p>
            <h2>Pending Restaurant Orders</h2>
          </div>
          <span>${pending.length} pending</span>
        </div>
        <div class="admin-order-grid">
          ${pending.length ? pending.map((order) => restaurantOrderCard(order)).join("") : `<p class="empty-state">No pending restaurant orders.</p>`}
        </div>
      </section>

      <section class="admin-panel" id="approved-orders">
        <div class="admin-panel-heading">
          <div>
            <p class="eyebrow">Approved Orders</p>
            <h2>Approved Orders</h2>
          </div>
          <span>${approved.length} approved</span>
        </div>
        <div class="admin-help-note">
          <strong>Odoo manual workflow</strong>
          <p>Step 1: Open Odoo POS. Step 2: Recreate this approved order manually. Step 3: Validate/send it from Odoo POS. Step 4: Odoo sends it to Kitchen Display.</p>
          <p>Enter this order manually into Odoo POS, then send it to the Odoo Kitchen Display.</p>
        </div>
        <div class="admin-order-grid">
          ${approved.length ? approved.map((order) => restaurantOrderCard(order, "approved")).join("") : `<p class="empty-state">No approved restaurant orders yet.</p>`}
        </div>
      </section>

      <section class="admin-panel">
        <div class="admin-panel-heading">
          <h2>Declined Restaurant Orders</h2>
          <span>${declined.length} declined</span>
        </div>
        <div class="admin-order-grid">
          ${declined.length ? declined.map((order) => restaurantOrderCard(order, "declined")).join("") : `<p class="empty-state">No declined restaurant orders.</p>`}
        </div>
      </section>
    </section>
  `;
}

function renderTable(section, rows) {
  const headers = section.columns.map(([label]) => `<th>${label}</th>`).join("");
  const body = rows.length
    ? rows
        .map(
          (row) => `
            <tr>
              ${section.columns
                .map(([, key]) => `<td>${formatValue(key, row[key], row)}</td>`)
                .join("")}
              <td>${statusPill(row.status)}</td>
              <td>${escapeHtml(row.message || "")}</td>
              <td>${actionButtons(section.table, row.id, row.status)}</td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="${section.columns.length + 3}">No requests yet.</td></tr>`;

  return `
    <section class="admin-panel">
      <div class="admin-panel-heading">
        <h2>${section.title}</h2>
        <span>${rows.length} total</span>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>${headers}<th>Status</th><th>Message</th><th>Update</th></tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>
  `;
}

function dashboardShell(content) {
  app.innerHTML = `
    ${Navbar("admin")}
    <main class="admin-shell" id="admin-main">
      <section class="admin-hero">
        <div>
          <p class="eyebrow">Admin Dashboard</p>
          <h1>Harla Hotel Requests</h1>
          <p>Approve restaurant orders, manage ordering availability, and review hotel requests.</p>
        </div>
        <img src="${images.logo}" alt="${siteConfig.brandName} logo" />
      </section>
      ${content}
    </main>
  `;

  document.querySelector("[data-header]")?.classList.add("is-scrolled");
  wireNav();
}

function renderLoading() {
  dashboardShell(`
    <section class="admin-card">
      <h2>Loading dashboard...</h2>
      <p class="form-status" role="status" aria-live="polite">
        Checking your admin session and loading Harla Hotel requests.
      </p>
    </section>
  `);
}

function dashboardWarnings(errors = []) {
  if (!errors.length) {
    return "";
  }

  return `
    <section class="admin-card">
      <h2>Some dashboard data could not load</h2>
      <p>The dashboard is still available. Check that the latest Supabase SQL has been run for these areas:</p>
      <ul class="admin-line-list">
        ${errors
          .map((error) => `<li><strong>${escapeHtml(error.key)}:</strong> ${escapeHtml(error.message)}</li>`)
          .join("")}
      </ul>
    </section>
  `;
}

function wireNav() {
  const navToggle = document.querySelector("[data-nav-toggle]");
  const navMenu = document.querySelector("[data-nav-menu]");

  navToggle?.addEventListener("click", () => {
    const expanded = navToggle.getAttribute("aria-expanded") === "true";
    navToggle.setAttribute("aria-expanded", String(!expanded));
    navMenu.classList.toggle("is-open");
  });
}

function renderSetupNotice() {
  dashboardShell(`
    <section class="admin-card">
      <h2>Connect Supabase</h2>
      <p>${backendSetupMessage()}</p>
      <p>
        Run <code>supabase/schema.sql</code> in Supabase, then add your project URL and anon key.
        The dashboard will unlock after an admin user signs in.
      </p>
    </section>
  `);
}

function redirectToLogin(message = "") {
  const loginUrl = new URL("./admin-login.html", window.location.href);
  loginUrl.searchParams.set("next", window.location.hash === "#approved-orders" ? "admin.html#approved-orders" : "admin.html");
  if (message) {
    loginUrl.searchParams.set("message", message);
  }
  window.location.replace(loginUrl.toString());
}

async function renderDashboard(adminProfile) {
  try {
    const data = await withTimeout(
      getAdminDashboardData(),
      "Supabase did not respond while loading dashboard data.",
    );
    const restaurantOrders = data.restaurantOrders || [];
    latestRoomBookings = data.roomBookings || [];
    const restaurantSettings = data.restaurantSettings || defaultRestaurantSettings;
    const totalPending =
      latestRoomBookings.filter((item) => item.status === "pending").length +
      restaurantOrders.filter((item) => item.status === "pending").length +
      requestSections.reduce(
        (total, section) =>
          total + (data[section.key] || []).filter((item) => item.status === "pending").length,
        0,
      );

    dashboardShell(`
      <section class="admin-toolbar">
        <div>
          <strong>${totalPending}</strong>
          <span>pending requests</span>
        </div>
        <span class="admin-user">${escapeHtml(adminProfile.full_name || adminProfile.email)}</span>
        <a class="btn btn-light" href="#approved-orders">Approved Orders</a>
        <button class="btn btn-light" type="button" id="admin-refresh">Refresh</button>
        <button class="btn btn-primary" type="button" id="admin-sign-out">Sign Out</button>
      </section>
      ${dashboardWarnings(data.dashboardErrors || [])}
      ${roomBookingsSection(latestRoomBookings, data.roomInventory || [])}
      ${restaurantOrdersSection(restaurantOrders, restaurantSettings)}
      <div class="admin-grid">
        ${requestSections.map((section) => renderTable(section, data[section.key] || [])).join("")}
      </div>
      <p class="admin-status" role="status" aria-live="polite"></p>
    `);

    bindAdminActions(adminProfile);
  } catch (error) {
    dashboardShell(`
      <section class="admin-toolbar">
        <span class="admin-user">${escapeHtml(adminProfile.full_name || adminProfile.email)}</span>
        <button class="btn btn-light" type="button" id="admin-refresh">Refresh</button>
        <button class="btn btn-primary" type="button" id="admin-sign-out">Sign Out</button>
      </section>
      <section class="admin-card">
        <h2>Dashboard data could not load</h2>
        <p>${escapeHtml(error.message || "Could not load the Harla Hotel admin dashboard data.")}</p>
        <p>Refresh this page after confirming Supabase tables, policies, and network access are available.</p>
      </section>
      <p class="admin-status" role="status" aria-live="polite"></p>
    `);
    bindAdminActions(adminProfile);
  }
}

function bindAdminActions(adminProfile) {
  document.querySelector("#admin-refresh")?.addEventListener("click", () => renderDashboard(adminProfile));
  document.querySelector("#admin-sign-out")?.addEventListener("click", async () => {
    await signOutAdmin();
    redirectToLogin("signed-out");
  });

  document.querySelectorAll("[data-room-booking-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const status = document.querySelector(".admin-status");
      try {
        status.textContent = "Updating room booking...";
        const updatedBooking = await updateRoomBookingStatus(
          button.dataset.roomBookingId,
          button.dataset.roomBookingStatus,
        );

        if (button.dataset.roomBookingStatus === "confirmed" && updatedBooking) {
          status.textContent = "Room booking confirmed. Generating confirmation PDF...";
          const { downloadBookingConfirmationPdf } = await import("./booking-confirmation-pdf.js?v=20260521-room-automation");
          await downloadBookingConfirmationPdf(updatedBooking);
        }

        await renderDashboard(adminProfile);
      } catch (error) {
        status.textContent = error.message || "Could not update this room booking.";
      }
    });
  });

  document.querySelectorAll("[data-room-contacted]").forEach((button) => {
    button.addEventListener("click", async () => {
      const status = document.querySelector(".admin-status");
      try {
        status.textContent = "Marking customer as contacted...";
        await markRoomBookingContacted(button.dataset.roomContacted);
        await renderDashboard(adminProfile);
      } catch (error) {
        status.textContent = error.message || "Could not mark this customer as contacted.";
      }
    });
  });

  document.querySelectorAll("[data-room-pdf]").forEach((button) => {
    button.addEventListener("click", async () => {
      const booking = latestRoomBookings.find((item) => item.id === button.dataset.roomPdf);
      if (!booking) {
        return;
      }
      const { downloadBookingConfirmationPdf } = await import("./booking-confirmation-pdf.js?v=20260521-room-automation");
      await downloadBookingConfirmationPdf(booking);
    });
  });

  document.querySelectorAll("[data-room-inventory-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = document.querySelector(".admin-status");
      const formData = Object.fromEntries(new FormData(event.currentTarget).entries());

      try {
        status.textContent = "Updating room availability...";
        await updateRoomInventory(event.currentTarget.dataset.roomInventoryForm, formData);
        await renderDashboard(adminProfile);
      } catch (error) {
        status.textContent = error.message || "Could not update room availability.";
      }
    });
  });

  document.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const status = document.querySelector(".admin-status");
      try {
        status.textContent = "Updating request...";
        await updateRequestStatus(button.dataset.table, button.dataset.id, button.dataset.status);
        await renderDashboard(adminProfile);
      } catch (error) {
        status.textContent = error.message || "Could not update this request.";
      }
    });
  });

  document.querySelectorAll("[data-order-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const status = document.querySelector(".admin-status");
      try {
        status.textContent = "Updating restaurant order...";
        await updateRestaurantOrderStatus(button.dataset.orderId, button.dataset.orderStatus);
        await renderDashboard(adminProfile);
      } catch (error) {
        status.textContent = error.message || "Could not update this restaurant order.";
      }
    });
  });

  document.querySelectorAll("[data-odoo-entered]").forEach((button) => {
    button.addEventListener("click", async () => {
      const status = document.querySelector(".admin-status");
      try {
        status.textContent = "Marking order as entered in Odoo...";
        await markRestaurantOrderEnteredInOdoo(button.dataset.odooEntered);
        await renderDashboard(adminProfile);
      } catch (error) {
        status.textContent = error.message || "Could not mark this order as entered in Odoo.";
      }
    });
  });

  document.querySelector("#restaurant-settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector(".admin-status");
    const formData = Object.fromEntries(new FormData(event.currentTarget).entries());

    try {
      status.textContent = "Saving restaurant settings...";
      await updateRestaurantSettings({
        orderingAvailable: formData.orderingAvailable === "on",
        customMessage: formData.customMessage,
      });
      await renderDashboard(adminProfile);
    } catch (error) {
      status.textContent = error.message || "Could not save restaurant settings.";
    }
  });
}

async function initAdmin() {
  if (!isBackendReady()) {
    renderSetupNotice();
    return;
  }

  renderLoading();

  try {
    const adminProfile = await withTimeout(
      requireAdminAccess(),
      "Supabase Auth did not respond while checking admin access.",
    );
    await renderDashboard(adminProfile);
  } catch (error) {
    await withTimeout(signOutAdmin(), "Supabase Auth did not respond while signing out.").catch(() => {});
    redirectToLogin(error.message || "login-required");
  }
}

initAdmin();
