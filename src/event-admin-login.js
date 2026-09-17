import { Navbar } from "./components.js?v=20260815-event-hall-v1";
import { images, siteConfig } from "./data.js?v=20260815-event-hall-v1";
import { requireEventAdminAccess } from "./event-api.js?v=20260818-event-request-v4";
import { getAdminSession, isBackendReady, signInAdmin, signOutAdmin } from "./supabase-api.js?v=20260818-event-request-v4";

const app = document.querySelector("#event-admin-login-app");
const params = new URLSearchParams(window.location.search);
const nextPage = params.get("next") || "event-admin.html";

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function safeNext() {
  if (nextPage === "event-admin.html") {
    return "./event-admin.html";
  }
  if (/^event-booking-detail\.html\?id=[0-9a-f-]{36}$/i.test(nextPage)) {
    return `./${nextPage}`;
  }
  return "./event-admin.html";
}

function shell(content) {
  app.innerHTML = `${Navbar("events")}<main class="admin-shell" id="event-admin-login-main"><section class="admin-hero"><div><p class="eyebrow">Events Team Access</p><h1>Harla Hotel Events</h1><p>Sign in to review requests, prepare quotes, verify payments, and manage confirmed Event Hall reservations.</p></div><img src="${images.logo}" alt="${siteConfig.brandName} logo" /></section>${content}</main>`;
  document.querySelector("[data-header]")?.classList.add("is-scrolled");
}

function renderLogin(message = "") {
  shell(`<section class="admin-login admin-card"><div><p class="eyebrow">Protected Access</p><h2>Events Team sign in</h2><p>Only active accounts in <code>event_admin_users</code> can open this dashboard.</p></div><form data-event-admin-login class="booking-form"><div class="form-grid"><label>Email<input name="email" type="email" autocomplete="email" required /></label><label>Password<input name="password" type="password" autocomplete="current-password" required /></label></div><button class="btn btn-primary" type="submit">Sign In to Events Dashboard</button><p class="form-status" role="status">${escapeHtml(message)}</p></form></section>`);
  document.querySelector("[data-event-admin-login]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector(".form-status");
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      status.textContent = "Signing in...";
      await signInAdmin(values.email, values.password);
      await requireEventAdminAccess();
      window.location.replace(safeNext());
    } catch (error) {
      await signOutAdmin().catch(() => {});
      status.textContent = error.message || "This account does not have Events Team access.";
    }
  });
}

async function init() {
  if (!isBackendReady()) {
    shell(`<section class="admin-card"><h2>Connect Supabase</h2><p>The Events Team dashboard requires the configured Harla Hotel Supabase project.</p></section>`);
    return;
  }
  shell(`<section class="admin-card"><h2>Checking Events Team access...</h2></section>`);
  try {
    if (await getAdminSession()) {
      await requireEventAdminAccess();
      window.location.replace(safeNext());
      return;
    }
  } catch {
    await signOutAdmin().catch(() => {});
  }
  renderLogin(params.get("message") || "");
}

init();
