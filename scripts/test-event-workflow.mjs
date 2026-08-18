import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

process.env.EVENT_PORTAL_TOKEN_SECRET = "event-portal-test-secret-with-more-than-32-characters";
process.env.SITE_URL = "https://harlahotel.com";
process.env.RESEND_API_KEY = "re_test_event_portal";
process.env.HARLA_EMAIL_FROM = "Harla Hotel Events <events@harlahotel.com>";

const workflow = await import("../server/event-workflow.js");
const { bookingForPortal, updateEventByAdmin } = await import("../server/event-booking-service.js");
const { renderEventEmail, rotateAndSendEventWorkflowEmail } = await import("../server/event-email-service.js");
const bookingCore = await import("../src/event-booking-core.js");
const portalAccess = await import("../src/event-portal-access.js");

const submissionToken = "c86babf1-70b4-4da7-9f46-5f79a5c05f55";
const firstToken = workflow.initialPortalToken(submissionToken);
const secondToken = workflow.initialPortalToken(submissionToken);
assert.equal(firstToken, secondToken, "Initial portal token must be recoverable for an idempotent submission.");
assert.equal(workflow.matchesPortalToken(workflow.hashPortalToken(firstToken), firstToken), true);
assert.equal(workflow.matchesPortalToken(workflow.hashPortalToken(firstToken), `${firstToken}x`), false);
assert.notEqual(workflow.rotatePortalToken(), workflow.rotatePortalToken());

class MemoryStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const accessReference = "HARLA-HALL-2026-0002";
const staleAccess = { reference: accessReference, token: "a".repeat(43) };
const freshAccess = { reference: accessReference, token: "b".repeat(43) };
const accessStorage = new MemoryStorage();
assert.equal(portalAccess.rememberPortalAccess(accessStorage, staleAccess), true);
const emailedAccess = portalAccess.portalAccessFromUrl(
  `https://harlahotel.com/event-request.html?reference=${accessReference}&token=${freshAccess.token}`,
);
assert.deepEqual(
  portalAccess.recoverPortalAccess(accessStorage),
  staleAccess,
  "An emailed token must not replace stored access before server validation succeeds.",
);
assert.deepEqual(emailedAccess, {
  hasSecureParameters: true,
  hasReference: true,
  hasToken: true,
  ...freshAccess,
});
assert.equal(
  portalAccess.sanitizedPortalLocation(`https://harlahotel.com/event-request.html?reference=${accessReference}&token=${freshAccess.token}`),
  "/event-request.html",
);
assert.equal(portalAccess.rememberPortalAccess(accessStorage, freshAccess), true);
assert.deepEqual(portalAccess.recoverPortalAccess(accessStorage), freshAccess);
portalAccess.forgetPortalAccess(accessStorage, staleAccess);
assert.deepEqual(
  portalAccess.recoverPortalAccess(accessStorage),
  freshAccess,
  "Rejecting an older emailed token must not erase a newer validated token.",
);
assert.equal(portalAccess.rememberPortalAccess(accessStorage, { reference: accessReference, token: "invalid" }), false);

assert.equal(workflow.assertEventTransition("pending_review", "approved_awaiting_payment"), "approved_awaiting_payment");
assert.equal(workflow.assertEventTransition("approved_awaiting_payment", "payment_submitted"), "payment_submitted");
assert.equal(workflow.assertEventTransition("payment_submitted", "confirmed"), "confirmed");
assert.equal(workflow.assertEventTransition("payment_submitted", "approved_awaiting_payment"), "approved_awaiting_payment");
assert.throws(() => workflow.assertEventTransition("pending_review", "confirmed"));
assert.throws(() => workflow.assertEventTransition("completed", "pending_review"));

assert.equal(workflow.BLOCKING_EVENT_STATUSES.includes("pending_review"), false);
assert.equal(workflow.BLOCKING_EVENT_STATUSES.includes("needs_information"), false);
assert.deepEqual(
  workflow.BLOCKING_EVENT_STATUSES,
  ["approved_awaiting_payment", "payment_submitted", "confirmed"],
);
assert.equal(workflow.slotsOverlap(
  { hallId: "hall-1", eventDate: "2026-10-10", startTime: "10:00", endTime: "12:00" },
  { hallId: "hall-1", eventDate: "2026-10-10", startTime: "11:30", endTime: "13:00" },
), true);
assert.equal(workflow.slotsOverlap(
  { hallId: "hall-1", eventDate: "2026-10-10", startTime: "10:00", endTime: "12:00" },
  { hallId: "hall-1", eventDate: "2026-10-10", startTime: "12:00", endTime: "13:00" },
), false);
assert.equal(workflow.slotsOverlap(
  { hallId: "hall-1", eventDate: "2026-08-20", startTime: "20:00", endTime: "01:00" },
  { hallId: "hall-1", eventDate: "2026-08-21", startTime: "00:30", endTime: "02:00" },
), true, "An overnight event must block a following-day event during its range.");
assert.equal(workflow.slotsOverlap(
  { hallId: "hall-1", eventDate: "2026-08-20", startTime: "20:00", endTime: "01:00" },
  { hallId: "hall-1", eventDate: "2026-08-21", startTime: "01:00", endTime: "02:00" },
), false, "A following-day event may start exactly when the overnight event ends.");
assert.equal(workflow.slotsOverlap(
  { hallId: "hall-1", eventDate: "2026-08-21", startTime: "00:30", endTime: "02:00" },
  { hallId: "hall-1", eventDate: "2026-08-20", startTime: "20:00", endTime: "01:00" },
), true, "Overlap must be symmetric when the next-day booking is checked first.");
assert.equal(workflow.slotsOverlap(
  { hallId: "hall-1", eventDate: "2026-08-20", startTime: "20:00", endTime: "01:00" },
  { hallId: "hall-2", eventDate: "2026-08-21", startTime: "00:30", endTime: "02:00" },
), false, "Different halls must remain independent.");
assert.equal(workflow.eventSlotRange(
  { eventDate: "2026-08-20", startTime: "20:00", endTime: "20:00" },
), null, "Equal start and end times must not become a 24-hour booking.");
assert.equal(
  bookingCore.formatEventTimeRange("20:00", "01:00"),
  "8:00 PM to 1:00 AM (next day)",
);
assert.match(
  bookingCore.validateEventBooking({
    hallId: "hall-1",
    clientFullName: "Muna Yusuf",
    email: "muna@example.com",
    phone: "+251911000000",
    eventType: "Conference",
    eventDate: "2099-08-20",
    startTime: "20:00",
    endTime: "20:00",
    attendees: 80,
  }, [{ id: "hall-1", name: "Harla Event Hall", capacity: 100 }]),
  /cannot be the same/i,
);

function transitionClient(result) {
  const filters = [];
  const updates = [];
  const query = {
    update(values) {
      updates.push(values);
      return this;
    },
    eq(column, value) {
      filters.push([column, value]);
      return this;
    },
    select() {
      return this;
    },
    async maybeSingle() {
      return result;
    },
  };
  return {
    supabase: { from: (table) => {
      assert.equal(table, "event_hall_bookings");
      return query;
    } },
    filters,
    updates,
  };
}

const staleTransition = transitionClient({ data: null, error: null });
await assert.rejects(
  updateEventByAdmin(
    staleTransition.supabase,
    { id: "booking-1", status: "pending_review", booking_reference: "HARLA-HALL-2026-0042" },
    "reject",
    { reason: "Not available" },
  ),
  (error) => error.code === "stale_event_request"
    && error.status === 409
    && /changed while you were reviewing/i.test(error.message),
);
assert.deepEqual(staleTransition.filters, [
  ["id", "booking-1"],
  ["status", "pending_review"],
], "Admin transitions must compare both booking ID and persisted status.");

const booking = {
  id: "private-row-id",
  booking_reference: "HARLA-HALL-2026-0042",
  client_full_name: "Muna Yusuf",
  organization: "Harar Culture Forum",
  email: "muna@example.com",
  phone: "+251 911 000 000",
  hall_name: "Harla Hotel Event Hall",
  hall_type: "Conference and Celebration Hall",
  event_type: "Conference",
  event_date: "2026-10-10",
  start_time: "10:00",
  end_time: "14:00",
  attendees: 80,
  refreshments_services: [{ name: "Coffee", quantity: 80, quantityLabel: "Servings" }],
  special_requests: "Projector and registration desk.",
  status: "approved_awaiting_payment",
  payment_status: "not_submitted",
  quoted_amount: 45000,
  quoted_currency: "ETB",
  payment_instructions: "Contact the Events Team for the approved payment channels.",
  payment_deadline: "2026-10-02T14:00:00+03:00",
  payment_screenshot_path: "event-hall-bookings/private.png",
  confirmation_pdf_path: "website/private.pdf",
  portal_token_hash: workflow.hashPortalToken(firstToken),
  created_at: "2026-08-18T08:00:00Z",
  updated_at: "2026-08-18T08:00:00Z",
};

const publicRecord = workflow.publicEventRecord(booking, "https://signed.example/confirmation");
for (const privateKey of [
  "id",
  "email",
  "phone",
  "portal_token_hash",
  "payment_screenshot_path",
  "confirmation_pdf_path",
  "created_by",
]) {
  assert.equal(Object.hasOwn(publicRecord, privateKey), false, `Public portal exposed ${privateKey}.`);
}
assert.equal(publicRecord.confirmationPdfUrl, "https://signed.example/confirmation");

for (const type of [
  "request_received",
  "needs_information",
  "payment_request",
  "payment_submitted",
  "confirmed",
  "status_update",
]) {
  const rendered = renderEventEmail(booking, type, firstToken);
  assert.match(rendered.subject, /HARLA-HALL-2026-0042/);
  assert.match(rendered.html, /Harla Hotel Events/);
  assert.match(rendered.portalUrl, /event-request\.html/);
  assert.match(rendered.portalUrl, /token=/);
  assert.equal(new URL(rendered.portalUrl).searchParams.get("token"), firstToken);
  assert.match(rendered.html, /events@harlahotel\.com/);
  assert.doesNotMatch(rendered.html, /booking@harlahotel\.com/);
}

function workflowEmailClient(baseBooking) {
  const updates = [];
  return {
    updates,
    supabase: {
      from(table) {
        assert.equal(table, "event_hall_bookings");
        let values = {};
        const query = {
          update(nextValues) {
            values = nextValues;
            updates.push(nextValues);
            return query;
          },
          eq() {
            return query;
          },
          select() {
            return query;
          },
          async single() {
            return { data: { ...baseBooking, ...values }, error: null };
          },
          then(resolve, reject) {
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          },
        };
        return query;
      },
    },
  };
}

const emailClient = workflowEmailClient(booking);
const originalFetch = globalThis.fetch;
let deliveredEmail = null;
globalThis.fetch = async (_url, options) => {
  deliveredEmail = JSON.parse(options.body);
  return { ok: true, async json() { return { id: "event-email-test" }; } };
};
try {
  const delivered = await rotateAndSendEventWorkflowEmail(emailClient.supabase, booking, "payment_request");
  const deliveredUrl = new URL(delivered.email.portalUrl);
  const deliveredToken = deliveredUrl.searchParams.get("token");
  const tokenUpdates = emailClient.updates.filter((values) => values.portal_token_hash);
  assert.equal(tokenUpdates.length, 1, "One email action must rotate the portal token exactly once.");
  assert.equal(workflow.matchesPortalToken(tokenUpdates[0].portal_token_hash, deliveredToken), true);
  assert.match(deliveredEmail.html, new RegExp(deliveredToken));
  const lookupSupabase = {
    from(table) {
      assert.equal(table, "event_hall_bookings");
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: delivered.booking, error: null }; },
      };
    },
  };
  assert.equal(
    (await bookingForPortal(lookupSupabase, booking.booking_reference, deliveredToken))?.booking_reference,
    booking.booking_reference,
    "The exact token sent in the newest email must authenticate against the stored hash.",
  );
  assert.equal(
    await bookingForPortal(lookupSupabase, booking.booking_reference, firstToken),
    null,
    "A rotated older email token must fail without exposing whether the reference exists.",
  );
} finally {
  globalThis.fetch = originalFetch;
}

const [
  roomAdmin,
  eventAdminApi,
  eventAdminLogin,
  confirmationApi,
  confirmationEmailApi,
  requestApi,
  portalApi,
  portalHtml,
  portalClient,
  eventBookingClient,
  eventApiClient,
  eventPortalAccessClient,
  eventEmailService,
  eventHallClient,
  eventBookingCoreClient,
  migration,
  baseSchema,
] = await Promise.all([
  readFile(new URL("../src/admin.js", import.meta.url), "utf8"),
  readFile(new URL("../api/event-admin.js", import.meta.url), "utf8"),
  readFile(new URL("../src/event-admin-login.js", import.meta.url), "utf8"),
  readFile(new URL("../api/event-confirmation.js", import.meta.url), "utf8"),
  readFile(new URL("../api/event-confirmation-email.js", import.meta.url), "utf8"),
  readFile(new URL("../api/event-request.js", import.meta.url), "utf8"),
  readFile(new URL("../api/event-portal.js", import.meta.url), "utf8"),
  readFile(new URL("../event-request.html", import.meta.url), "utf8"),
  readFile(new URL("../src/event-request.js", import.meta.url), "utf8"),
  readFile(new URL("../src/event-booking.js", import.meta.url), "utf8"),
  readFile(new URL("../src/event-api.js", import.meta.url), "utf8"),
  readFile(new URL("../src/event-portal-access.js", import.meta.url), "utf8"),
  readFile(new URL("../server/event-email-service.js", import.meta.url), "utf8"),
  readFile(new URL("../src/event-hall.js", import.meta.url), "utf8"),
  readFile(new URL("../src/event-booking-core.js", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260817215359_event_hall_request_workflow_v2.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
]);
assert.doesNotMatch(roomAdmin, /event_hall_bookings|event_requests|Event Hall/);
assert.match(eventAdminApi, /requestingEventAdmin/);
assert.doesNotMatch(eventAdminApi, /requestingAdmin\s*\(/);
assert.match(confirmationApi, /requestingEventAdmin/);
assert.doesNotMatch(confirmationApi, /requestingAdmin\s*\(/);
assert.match(confirmationEmailApi, /requestingEventAdmin/);
assert.doesNotMatch(confirmationEmailApi, /requestingAdmin\s*\(/);
assert.doesNotMatch(requestApi, /requestingAdmin\s*\(|requestingEventAdmin\s*\(/);
assert.doesNotMatch(portalApi, /requestingAdmin\s*\(|requestingEventAdmin\s*\(/);
assert.match(eventAdminLogin, /\^event-booking-detail\\\.html/);
assert.doesNotMatch(eventAdminLogin, /startsWith\("http"\)/);
assert.match(confirmationApi, /body\.regenerate && !adminUser/);
assert.match(portalHtml, /<meta name="referrer" content="no-referrer"/);
assert.match(portalClient, /history\.replaceState/);
assert.match(eventPortalAccessClient, /searchParams\.delete\("token"\)/);
assert.match(eventPortalAccessClient, /searchParams\.delete\("reference"\)/);
assert.doesNotMatch(portalClient, /Private access token|data-event-access-form/);
assert.match(portalClient, /This secure request link is no longer valid/);
assert.match(portalClient, /rememberPortalAccess/);
assert.doesNotMatch(portalClient, /console\.(?:log|info|debug).*token/i);
assert.match(eventAdminApi, /rotateAndSendEventWorkflowEmail/);
assert.doesNotMatch(eventAdminApi, /import[\s\S]{0,120}rotateBookingPortalToken[\s\S]{0,120}event-booking-service/);
assert.match(confirmationEmailApi, /rotateAndSendEventWorkflowEmail/);
assert.doesNotMatch(confirmationEmailApi, /rotateBookingPortalToken/);
assert.match(eventBookingClient, /emailDelivery\?\.sent/);
for (const eventContactSource of [portalClient, eventBookingClient, eventEmailService, eventHallClient, eventBookingCoreClient]) {
  assert.match(eventContactSource, /events@harlahotel\.com|eventsEmail/);
  assert.doesNotMatch(eventContactSource, /booking@harlahotel\.com/);
}
for (const browserFile of [portalClient, eventBookingClient, eventApiClient, eventPortalAccessClient]) {
  assert.doesNotMatch(
    browserFile,
    /SUPABASE_SERVICE_ROLE_KEY|EVENT_PORTAL_TOKEN_SECRET|RESEND_API_KEY|STRIPE_SECRET_KEY/,
    "A server secret name appeared in Event Hall browser code.",
  );
}
assert.match(migration, /Event admins can read event hall bookings/);
assert.match(migration, /drop policy if exists "Admins can read event hall bookings"/);
assert.match(migration, /revoke all on public\.event_hall_bookings from anon, authenticated/);
assert.match(migration, /Block browser event payment proof inserts/);
assert.match(migration, /where \(status in \('approved_awaiting_payment', 'payment_submitted', 'confirmed'\)\)/);
assert.match(migration, /grant select on table public\.event_admin_users to service_role/);
assert.match(migration, /grant select, insert, update on table public\.event_hall_bookings to service_role/);
assert.match(migration, /grant select on table public\.event_halls to service_role/);
assert.match(migration, /grant select on table public\.event_requests to service_role/);
assert.doesNotMatch(migration, /grant\s+(?:all|delete).*service_role/i);
assert.match(migration, /when end_time < start_time then interval '1 day'/);
assert.match(migration, /when booking\.end_time < booking\.start_time then interval '1 day'/);
assert.match(migration, /when p_end_time < p_start_time then interval '1 day'/);
assert.match(migration, /event_hall_booking_valid_time check \(end_time <> start_time\)/);
assert.match(baseSchema, /using \(public\.is_harla_admin\(\)\)/);

console.log("Event Hall workflow, token, email-template, availability, and admin-separation checks passed.");
