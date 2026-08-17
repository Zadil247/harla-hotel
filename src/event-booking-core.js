import { siteConfig } from "./data.js?v=20260815-event-hall-v1";

export const EVENT_TYPES = [
  "Conference",
  "Government Meeting",
  "Corporate Meeting",
  "Workshop",
  "Training",
  "Seminar",
  "Wedding",
  "Reception",
  "Private Event",
  "Other",
];

export const EVENT_SERVICE_OPTIONS = [
  { id: "tea", label: "Tea", quantityLabel: "Servings" },
  { id: "coffee", label: "Coffee", quantityLabel: "Servings" },
  { id: "bottled-water", label: "Bottled Water", quantityLabel: "Bottles" },
  { id: "soft-drinks", label: "Soft Drinks", quantityLabel: "Bottles" },
  { id: "breakfast", label: "Breakfast", quantityLabel: "Guests" },
  { id: "lunch", label: "Lunch", quantityLabel: "Guests" },
  { id: "dinner", label: "Dinner", quantityLabel: "Guests" },
  { id: "snacks", label: "Snacks", quantityLabel: "Servings" },
  { id: "other", label: "Other Service", quantityLabel: "Quantity" },
];

export const EVENT_PAYMENT_METHODS = [
  {
    value: "payment_arranged_later",
    label: "Payment arrangement pending",
    instructions: "Harla Hotel will confirm the event requirements and payment amount before payment is due.",
  },
  {
    value: "cbe",
    label: "CBE",
    instructions: "CBE: 1000703782756 - Harla Hotel",
  },
  {
    value: "telebirr",
    label: "Telebirr",
    instructions: "Telebirr: 0915321828 - Rekib",
  },
  {
    value: "ebirr",
    label: "E-Birr",
    instructions: "E-Birr: 0915321188",
  },
  {
    value: "bank_transfer",
    label: "Bank transfer arranged with Harla Hotel",
    instructions: `Contact ${siteConfig.phone} or ${siteConfig.email} for the current bank transfer details.`,
  },
];

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function createEventSubmissionToken() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function todayIso() {
  const today = new Date();
  const local = new Date(today.getTime() - today.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function eventPaymentMethod(method) {
  return EVENT_PAYMENT_METHODS.find((item) => item.value === method) || EVENT_PAYMENT_METHODS[0];
}

export function eventPaymentNeedsProof(method) {
  return Boolean(method && method !== "payment_arranged_later");
}

export function displayEventType(booking) {
  return String(booking.event_type || "").toLowerCase() === "other"
    ? booking.custom_event_type || "Other"
    : booking.event_type || "-";
}

export function formatEventDate(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-ET", { dateStyle: "long" }).format(
    new Date(`${value}T00:00:00`),
  );
}

export function formatEventTime(value) {
  if (!value) {
    return "-";
  }

  const [hours, minutes] = String(value).split(":").map(Number);
  const date = new Date(2000, 0, 1, hours, minutes);
  return new Intl.DateTimeFormat("en-ET", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function normalizeEventServices(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && item.name)
    .map((item) => ({
      id: String(item.id || "service"),
      name: String(item.name),
      quantity: Number(item.quantity) > 0 ? Number(item.quantity) : null,
      quantityLabel: String(item.quantityLabel || "Quantity"),
      notes: String(item.notes || "").trim() || null,
    }));
}

export function collectEventServices(formData) {
  return EVENT_SERVICE_OPTIONS.flatMap((service) => {
    if (formData.get(`service-${service.id}`) !== "on") {
      return [];
    }

    const quantity = Number(formData.get(`service-${service.id}-quantity`));
    const notes = String(formData.get(`service-${service.id}-notes`) || "").trim();
    return [{
      id: service.id,
      name: service.id === "other" && notes ? notes : service.label,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
      quantityLabel: service.quantityLabel,
      notes: service.id === "other" ? null : notes || null,
    }];
  });
}

export function collectEventBookingForm(form) {
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  payload.refreshmentsServices = collectEventServices(formData);
  payload.attendees = Number(payload.attendees);
  payload.paymentProof = formData.get("paymentProof");
  return payload;
}

export function validateEventBooking(payload, halls = [], options = {}) {
  const hall = halls.find((item) => String(item.id) === String(payload.hallId));
  const email = String(payload.email || "").trim();
  const phone = String(payload.phone || "").trim();
  const fullName = String(payload.clientFullName || "").trim();
  const eventType = String(payload.eventType || "").trim();
  const attendees = Number(payload.attendees);

  if (!hall) {
    return "Please choose an available event hall.";
  }
  if (fullName.length < 2 || fullName.length > 160) {
    return "Please enter the client or contact person's full name.";
  }
  if (phone.length < 7 || phone.length > 40) {
    return "Please enter a valid phone number.";
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Please enter a valid email address.";
  }
  if (!eventType) {
    return "Please choose an event type.";
  }
  if (eventType === "Other" && !String(payload.customEventType || "").trim()) {
    return "Please describe the event type.";
  }
  if (!payload.eventDate || payload.eventDate < todayIso()) {
    return "Please choose today or a future event date.";
  }
  if (!payload.startTime || !payload.endTime) {
    return "Please choose both the start time and end time.";
  }
  if (payload.endTime <= payload.startTime) {
    return "End time must be later than start time.";
  }
  if (!Number.isInteger(attendees) || attendees < 1 || attendees > 10000) {
    return "Please enter a valid number of attendees.";
  }
  if (hall.capacity && attendees > Number(hall.capacity)) {
    return `${hall.name} supports up to ${hall.capacity} attendees. Please contact Harla Hotel for another arrangement.`;
  }

  const validPayment = EVENT_PAYMENT_METHODS.some((method) => method.value === payload.paymentMethod);
  if (!validPayment) {
    return "Please choose a payment arrangement.";
  }

  if (eventPaymentNeedsProof(payload.paymentMethod)) {
    if (!String(payload.paymentReference || "").trim()) {
      return "Please enter the payment or transfer reference.";
    }
    const proof = payload.paymentProof;
    if (!options.existingPaymentProof && !proof?.name) {
      return "Please upload the payment confirmation image.";
    }
    if (proof?.name) {
      const extension = proof.name.split(".").pop()?.toLowerCase();
      const allowed = new Set(["jpg", "jpeg", "png", "webp"]);
      if (!allowed.has(extension) || !["image/jpeg", "image/png", "image/webp"].includes(proof.type)) {
        return "Payment confirmation must be JPG, JPEG, PNG, or WebP.";
      }
      if (proof.size > 5 * 1024 * 1024) {
        return "Payment confirmation must be 5 MB or smaller.";
      }
    }
  }

  return "";
}

function optionMarkup(value, label, selectedValue) {
  return `<option value="${escapeHtml(value)}" ${String(value) === String(selectedValue) ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

export function eventBookingFormMarkup({ halls = [], values = {}, mode = "public" } = {}) {
  const isAdmin = mode === "admin";
  const selectedPayment = values.paymentMethod || "payment_arranged_later";
  const selectedType = values.eventType || "";

  return `
    <form class="event-reservation-form" data-event-reservation-form novalidate>
      <div class="event-form-section">
        <div class="event-form-section-heading">
          <span>1</span>
          <div><h3>Client information</h3><p>Primary contact for this reservation.</p></div>
        </div>
        <div class="event-form-grid">
          <label>
            Full name <span aria-hidden="true">*</span>
            <input name="clientFullName" type="text" autocomplete="name" maxlength="160" value="${escapeHtml(values.clientFullName || "")}" placeholder="Contact person's full name" required />
          </label>
          <label>
            Organization / institution
            <input name="organization" type="text" autocomplete="organization" maxlength="180" value="${escapeHtml(values.organization || "")}" placeholder="Optional for private clients" />
          </label>
          <label>
            Email
            <input name="email" type="email" autocomplete="email" maxlength="254" value="${escapeHtml(values.email || "")}" placeholder="name@organization.com" />
          </label>
          <label>
            Phone number <span aria-hidden="true">*</span>
            <input name="phone" type="tel" autocomplete="tel" maxlength="40" value="${escapeHtml(values.phone || "")}" placeholder="+251 9..." required />
          </label>
          <label class="event-form-wide">
            Address
            <input name="address" type="text" autocomplete="street-address" maxlength="240" value="${escapeHtml(values.address || "")}" placeholder="City or organization address (optional)" />
          </label>
        </div>
      </div>

      <div class="event-form-section">
        <div class="event-form-section-heading">
          <span>2</span>
          <div><h3>Event details</h3><p>Date, time, venue, and expected attendance.</p></div>
        </div>
        <div class="event-form-grid">
          <label class="event-form-wide">
            Event hall <span aria-hidden="true">*</span>
            <select name="hallId" required>
              <option value="">Choose a hall</option>
              ${halls.map((hall) => optionMarkup(hall.id, `${hall.name} · ${hall.hall_type}`, values.hallId)).join("")}
            </select>
          </label>
          <label>
            Event type <span aria-hidden="true">*</span>
            <select name="eventType" required>
              <option value="">Choose event type</option>
              ${EVENT_TYPES.map((type) => optionMarkup(type, type, selectedType)).join("")}
            </select>
          </label>
          <label data-custom-event-type ${selectedType === "Other" ? "" : "hidden"}>
            Specify event type <span aria-hidden="true">*</span>
            <input name="customEventType" type="text" maxlength="120" value="${escapeHtml(values.customEventType || "")}" placeholder="Describe the event" />
          </label>
          <label>
            Event date <span aria-hidden="true">*</span>
            <input name="eventDate" type="date" min="${todayIso()}" value="${escapeHtml(values.eventDate || "")}" required />
          </label>
          <label>
            Number of attendees <span aria-hidden="true">*</span>
            <input name="attendees" type="number" min="1" max="10000" step="1" value="${escapeHtml(values.attendees || "")}" placeholder="60" required />
          </label>
          <label>
            Start time <span aria-hidden="true">*</span>
            <input name="startTime" type="time" value="${escapeHtml(values.startTime || "")}" required />
          </label>
          <label>
            End time <span aria-hidden="true">*</span>
            <input name="endTime" type="time" value="${escapeHtml(values.endTime || "")}" required />
          </label>
        </div>
      </div>

      <div class="event-form-section">
        <div class="event-form-section-heading">
          <span>3</span>
          <div><h3>Refreshments and services</h3><p>Select only what the event requires. Final pricing is confirmed by Harla Hotel.</p></div>
        </div>
        <div class="event-service-selector">
          ${EVENT_SERVICE_OPTIONS.map((service) => `
            <div class="event-service-option" data-event-service-option="${service.id}">
              <label class="event-service-check">
                <input name="service-${service.id}" type="checkbox" />
                <span>${escapeHtml(service.label)}</span>
              </label>
              <label>
                ${escapeHtml(service.quantityLabel)}
                <input name="service-${service.id}-quantity" type="number" min="1" max="10000" placeholder="Optional" disabled />
              </label>
              ${service.id === "other" ? `<label>Service details<input name="service-${service.id}-notes" type="text" maxlength="160" placeholder="Describe the service" disabled /></label>` : ""}
            </div>
          `).join("")}
        </div>
        <label class="event-form-block">
          Additional requests
          <textarea name="specialRequests" rows="4" maxlength="1500" placeholder="Seating arrangement, presentation setup, decoration, accessibility, or other requests">${escapeHtml(values.specialRequests || "")}</textarea>
        </label>
      </div>

      <div class="event-form-section">
        <div class="event-form-section-heading">
          <span>4</span>
          <div><h3>Payment information</h3><p>Submit an existing receipt, or arrange payment after Harla Hotel reviews the event.</p></div>
        </div>
        <div class="event-form-grid">
          <label class="event-form-wide">
            Payment arrangement <span aria-hidden="true">*</span>
            <select name="paymentMethod" required>
              ${EVENT_PAYMENT_METHODS.map((method) => optionMarkup(method.value, method.label, selectedPayment)).join("")}
            </select>
          </label>
        </div>
        <div class="event-payment-instructions" data-event-payment-instructions>
          ${escapeHtml(eventPaymentMethod(selectedPayment).instructions)}
        </div>
        <div class="event-form-grid event-payment-proof-fields" data-event-payment-proof-fields ${eventPaymentNeedsProof(selectedPayment) ? "" : "hidden"}>
          <label>
            Payment reference <span aria-hidden="true">*</span>
            <input name="paymentReference" type="text" maxlength="160" value="${escapeHtml(values.paymentReference || "")}" placeholder="Transaction or transfer reference" />
          </label>
          <label class="event-upload-field">
            Payment confirmation <span aria-hidden="true">*</span>
            <input name="paymentProof" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" />
            <span data-event-proof-name>JPG, PNG, or WebP, up to 5 MB</span>
          </label>
        </div>
        ${isAdmin ? `
          <div class="event-form-grid event-admin-status-fields">
            <label>
              Booking status
              <select name="adminStatus">
                ${optionMarkup("pending", "Pending", values.adminStatus || "pending")}
                ${optionMarkup("confirmed", "Confirmed", values.adminStatus || "pending")}
              </select>
            </label>
            <label>
              Payment status
              <select name="adminPaymentStatus">
                ${optionMarkup("not_submitted", "Not submitted", values.adminPaymentStatus || "not_submitted")}
                ${optionMarkup("pending_payment_confirmation", "Pending verification", values.adminPaymentStatus || "not_submitted")}
                ${optionMarkup("verified", "Verified", values.adminPaymentStatus || "not_submitted")}
                ${optionMarkup("declined", "Declined", values.adminPaymentStatus || "not_submitted")}
              </select>
            </label>
          </div>
        ` : ""}
      </div>

      <div class="event-form-footer">
        <p><strong>No online charge is made by this form.</strong> Harla Hotel reviews the date, setup, and payment information before final confirmation.</p>
        <button class="btn btn-primary" type="submit">${isAdmin ? "Review Admin Booking" : "Review Reservation"}</button>
      </div>
      <p class="form-status" role="status" aria-live="polite"></p>
    </form>
  `;
}

export function wireEventBookingForm(form) {
  const paymentSelect = form.querySelector("[name='paymentMethod']");
  const paymentFields = form.querySelector("[data-event-payment-proof-fields]");
  const paymentInstructions = form.querySelector("[data-event-payment-instructions]");
  const customType = form.querySelector("[data-custom-event-type]");

  function updatePayment() {
    const method = eventPaymentMethod(paymentSelect.value);
    paymentInstructions.textContent = method.instructions;
    paymentFields.hidden = !eventPaymentNeedsProof(method.value);
    paymentFields.querySelectorAll("input").forEach((input) => {
      input.required = eventPaymentNeedsProof(method.value);
    });
  }

  function updateEventType() {
    const show = form.elements.eventType.value === "Other";
    customType.hidden = !show;
    form.elements.customEventType.required = show;
  }

  form.querySelectorAll("[data-event-service-option]").forEach((option) => {
    const checkbox = option.querySelector("input[type='checkbox']");
    const dependentInputs = option.querySelectorAll("input:not([type='checkbox'])");
    checkbox.addEventListener("change", () => {
      option.classList.toggle("is-selected", checkbox.checked);
      dependentInputs.forEach((input) => {
        input.disabled = !checkbox.checked;
        if (!checkbox.checked) {
          input.value = "";
        }
      });
    });
  });

  form.elements.eventType.addEventListener("change", updateEventType);
  paymentSelect.addEventListener("change", updatePayment);
  form.elements.paymentProof?.addEventListener("change", (event) => {
    const fileName = form.querySelector("[data-event-proof-name]");
    fileName.textContent = event.target.files[0]?.name || "JPG, PNG, or WebP, up to 5 MB";
  });
  updatePayment();
  updateEventType();
}

export function eventBookingSummaryMarkup(payload, hall) {
  const services = normalizeEventServices(payload.refreshmentsServices);
  const payment = eventPaymentMethod(payload.paymentMethod);
  const detail = (label, value) => `
    <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "-")}</dd></div>
  `;

  return `
    <section class="event-review-card" aria-labelledby="event-review-title">
      <div class="event-review-heading">
        <div><p class="eyebrow">Reservation Review</p><h2 id="event-review-title">Confirm the event details</h2></div>
        <span>Price on review</span>
      </div>
      <dl class="event-review-details">
        ${detail("Client", payload.clientFullName)}
        ${payload.organization ? detail("Organization", payload.organization) : ""}
        ${payload.email ? detail("Email", payload.email) : ""}
        ${detail("Phone", payload.phone)}
        ${detail("Hall", hall?.name)}
        ${detail("Event type", payload.eventType === "Other" ? payload.customEventType : payload.eventType)}
        ${detail("Event date", formatEventDate(payload.eventDate))}
        ${detail("Time", `${formatEventTime(payload.startTime)} to ${formatEventTime(payload.endTime)}`)}
        ${detail("Attendees", payload.attendees)}
        ${detail("Payment", payment.label)}
      </dl>
      <div class="event-review-services">
        <h3>Refreshments and services</h3>
        ${services.length ? `
          <ul>${services.map((service) => `<li><strong>${escapeHtml(service.name)}</strong>${service.quantity ? `, ${escapeHtml(service.quantity)} ${escapeHtml(service.quantityLabel.toLowerCase())}` : ""}${service.notes ? `, ${escapeHtml(service.notes)}` : ""}</li>`).join("")}</ul>
        ` : "<p>No refreshments or additional services selected.</p>"}
      </div>
      ${payload.specialRequests ? `<div class="event-review-note"><h3>Additional requests</h3><p>${escapeHtml(payload.specialRequests)}</p></div>` : ""}
      <div class="event-review-actions">
        <button class="btn btn-light" type="button" data-edit-event-booking>Edit Details</button>
        <button class="btn btn-primary" type="button" data-confirm-event-booking>Confirm Reservation</button>
      </div>
      <p class="form-status" role="status" aria-live="polite"></p>
    </section>
  `;
}
