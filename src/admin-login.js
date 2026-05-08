import { Navbar } from "./components.js?v=20260507-supabase";
import { images, siteConfig } from "./data.js?v=20260507-supabase";
import {
  backendSetupMessage,
  getAdminSession,
  getCurrentAdminProfile,
  isBackendReady,
  signInAdmin,
  signOutAdmin,
} from "./supabase-api.js?v=20260507-supabase";

const app = document.querySelector("#admin-login-app");
const params = new URLSearchParams(window.location.search);
const nextPage = params.get("next") || "admin.html";

const messageMap = {
  "signed-out": "Signed out successfully.",
  "admin-required": "Please sign in with an active Harla Hotel admin account.",
  "login-required": "Please sign in to access the Harla Hotel admin dashboard.",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeNextUrl() {
  if (nextPage.startsWith("http") || nextPage.startsWith("//")) {
    return "./admin.html";
  }

  return nextPage;
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

function shell(content) {
  app.innerHTML = `
    ${Navbar("admin")}
    <main class="admin-shell" id="admin-login-main">
      <section class="admin-hero">
        <div>
          <p class="eyebrow">Admin Login</p>
          <h1>Harla Hotel Admin</h1>
          <p>Sign in with Supabase email and password to manage bookings and customer requests.</p>
        </div>
        <img src="${images.logo}" alt="${siteConfig.brandName} logo" />
      </section>
      ${content}
    </main>
  `;

  document.querySelector("[data-header]")?.classList.add("is-scrolled");
  wireNav();
}

function renderSetupNotice() {
  shell(`
    <section class="admin-card">
      <h2>Connect Supabase</h2>
      <p>${backendSetupMessage()}</p>
      <p>
        After Supabase is configured, this page will use Supabase Auth email/password login
        and redirect authenticated admins to the dashboard.
      </p>
    </section>
  `);
}

function renderLogin(message = "") {
  shell(`
    <section class="admin-login admin-card">
      <div>
        <p class="eyebrow">Protected Access</p>
        <h2>Sign in as admin</h2>
        <p>
          Only Supabase Auth users listed as active records in <code>admin_users</code> can open the dashboard,
          view bookings, and approve or reject requests.
        </p>
      </div>
      <form id="admin-login-form" class="booking-form">
        <div class="form-grid">
          <label>
            Email
            <input name="email" type="email" autocomplete="email" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autocomplete="current-password" required />
          </label>
        </div>
        <button class="btn btn-primary" type="submit">Sign In</button>
        <p class="form-status" role="status" aria-live="polite">${escapeHtml(message)}</p>
      </form>
    </section>
  `);

  document.querySelector("#admin-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector(".form-status");
    const data = Object.fromEntries(new FormData(form).entries());

    if (!data.email?.trim() || !data.password?.trim()) {
      status.textContent = "Email and password are required.";
      return;
    }

    try {
      status.textContent = "Signing in...";
      await signInAdmin(data.email, data.password);
      const profile = await getCurrentAdminProfile();

      if (!profile) {
        await signOutAdmin();
        status.textContent = "This account is not an active Harla Hotel admin.";
        return;
      }

      window.location.replace(safeNextUrl());
    } catch (error) {
      status.textContent = error.message || "Could not sign in.";
    }
  });
}

async function initLogin() {
  if (!isBackendReady()) {
    renderSetupNotice();
    return;
  }

  try {
    const session = await getAdminSession();

    if (session) {
      const profile = await getCurrentAdminProfile();
      if (profile) {
        window.location.replace(safeNextUrl());
        return;
      }
      await signOutAdmin();
    }
  } catch (error) {
    await signOutAdmin().catch(() => {});
  }

  const message = messageMap[params.get("message")] || params.get("message") || "";
  renderLogin(message);
}

initLogin();
