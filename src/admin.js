import { Navbar } from "./components.js?v=20260507-supabase";
import { images, siteConfig } from "./data.js?v=20260507-supabase";
import {
  backendSetupMessage,
  getAdminDashboardData,
  isBackendReady,
  requireAdminAccess,
  signOutAdmin,
  updateRequestStatus,
} from "./supabase-api.js?v=20260507-supabase";

const app = document.querySelector("#admin-app");

const sections = [
  {
    key: "roomBookings",
    table: "room_bookings",
    title: "Room Bookings",
    columns: [
      ["Guest", "full_name"],
      ["Phone", "phone"],
      ["Room", "room_name"],
      ["Check-in", "check_in"],
      ["Check-out", "check_out"],
      ["Nights", "nights"],
      ["Rooms", "number_of_rooms"],
      ["Total", "total_price"],
    ],
  },
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

function formatValue(key, value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (key === "total_price") {
    return `${new Intl.NumberFormat("en-US").format(Number(value))} ETB`;
  }

  return escapeHtml(value);
}

function dashboardShell(content) {
  app.innerHTML = `
    ${Navbar("admin")}
    <main class="admin-shell" id="admin-main">
      <section class="admin-hero">
        <div>
          <p class="eyebrow">Admin Dashboard</p>
          <h1>Harla Hotel Requests</h1>
          <p>Review pending room bookings, event hall inquiries, restaurant requests, and package requests.</p>
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
  loginUrl.searchParams.set("next", "admin.html");
  if (message) {
    loginUrl.searchParams.set("message", message);
  }
  window.location.replace(loginUrl.toString());
}

function statusPill(status) {
  return `<span class="status-pill status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function actionButtons(table, id, currentStatus) {
  return `
    <div class="admin-actions">
      ${["approved", "rejected", "pending"]
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

function renderTable(section, rows) {
  const headers = section.columns.map(([label]) => `<th>${label}</th>`).join("");
  const body = rows.length
    ? rows
        .map(
          (row) => `
            <tr>
              ${section.columns
                .map(([, key]) => `<td>${formatValue(key, row[key])}</td>`)
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

async function renderDashboard(adminProfile) {
  try {
    const data = await getAdminDashboardData();
    const totalPending = sections.reduce(
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
        <button class="btn btn-light" type="button" id="admin-refresh">Refresh</button>
        <button class="btn btn-primary" type="button" id="admin-sign-out">Sign Out</button>
      </section>
      <div class="admin-grid">
        ${sections.map((section) => renderTable(section, data[section.key] || [])).join("")}
      </div>
      <p class="admin-status" role="status" aria-live="polite"></p>
    `);

    document.querySelector("#admin-refresh").addEventListener("click", () => renderDashboard(adminProfile));
    document.querySelector("#admin-sign-out").addEventListener("click", async () => {
      await signOutAdmin();
      redirectToLogin("signed-out");
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
  } catch (error) {
    redirectToLogin("admin-required");
  }
}

async function initAdmin() {
  if (!isBackendReady()) {
    renderSetupNotice();
    return;
  }

  try {
    const adminProfile = await requireAdminAccess();
    await renderDashboard(adminProfile);
  } catch (error) {
    await signOutAdmin().catch(() => {});
    redirectToLogin(error.message || "login-required");
  }
}

initAdmin();
