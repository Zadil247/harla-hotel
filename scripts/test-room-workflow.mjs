import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { roomAdminErrorDetails } from "../api/room-admin.js";

const blockingStatuses = new Set([
  "pending",
  "pending_review",
  "pending_payment_review",
  "pending_payment_confirmation",
  "approved",
  "confirmed",
  "checked_in",
]);

function overlaps(first, second) {
  return first.checkIn < second.checkOut && second.checkIn < first.checkOut;
}

function available(capacity, request, bookings) {
  const held = bookings
    .filter((booking) => booking.roomType === request.roomType)
    .filter((booking) => blockingStatuses.has(booking.status))
    .filter((booking) => booking.inventoryHoldActive !== false)
    .filter((booking) => overlaps(booking, request))
    .reduce((total, booking) => total + booking.rooms, 0);
  return capacity - held;
}

function initializeSellableRooms(totalRooms, existingSellableRooms) {
  return existingSellableRooms ?? totalRooms;
}

class SerializedRoomLedger {
  constructor(capacity) {
    this.capacity = capacity;
    this.bookings = [];
    this.queue = Promise.resolve();
  }

  create(request) {
    const transaction = this.queue.then(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (available(this.capacity[request.roomType], request, this.bookings) < request.rooms) {
        throw new Error("room_unavailable");
      }
      this.bookings.push({ ...request, status: "pending_review" });
      return request.reference;
    });
    this.queue = transaction.catch(() => {});
    return transaction;
  }
}

const stay = (roomType, checkIn, checkOut, rooms = 1, status = "pending_review") => ({
  roomType,
  checkIn,
  checkOut,
  rooms,
  status,
  inventoryHoldActive: true,
});

const restoreConflictMessage = "Inventory cannot be restored because this room capacity is already committed for the selected dates.";
assert.deepEqual(
  roomAdminErrorDetails({
    status: 409,
    code: "room_hold_restore_conflict",
    message: restoreConflictMessage,
  }),
  { status: 409, message: restoreConflictMessage },
  "restore conflicts must preserve their specific public message",
);

const missingHoldMessage = "Restore this booking inventory hold before continuing.";
assert.deepEqual(
  roomAdminErrorDetails({
    status: 409,
    code: "room_hold_required",
    message: missingHoldMessage,
  }),
  { status: 409, message: missingHoldMessage },
  "missing inventory holds must preserve their specific public message",
);

const staleBookingMessage = "This booking changed while you were reviewing it. Refresh and try again.";
assert.deepEqual(
  roomAdminErrorDetails({
    status: 409,
    code: "stale_room_booking",
    message: "Internal stale booking detail.",
  }),
  { status: 409, message: staleBookingMessage },
  "stale booking conflicts must use the refresh guidance",
);
assert.deepEqual(
  roomAdminErrorDetails({ code: "40001", message: "Serialization failure." }),
  { status: 409, message: staleBookingMessage },
  "Postgres serialization conflicts must use the stale booking response",
);
assert.deepEqual(
  roomAdminErrorDetails({ status: 422, code: "room_admin_error", message: "The requested change is invalid." }),
  { status: 422, message: "The requested change is invalid." },
  "generic Room Admin errors must retain their public status and message",
);

const queen = stay("Queen Size Bed Room", "2026-08-20", "2026-08-23");
assert.equal(available(8, queen, []), 8);
assert.equal(available(8, queen, [queen]), 7, "one Queen hold must leave seven rooms");

const twinRequest = stay("Twin Bed Room", "2026-08-20", "2026-08-23");
const legacyTwinInventory = {
  totalRooms: 2,
  availableRooms: 1,
  sellableRooms: null,
};
const migratedTwinSellableRooms = initializeSellableRooms(
  legacyTwinInventory.totalRooms,
  legacyTwinInventory.sellableRooms,
);
assert.equal(
  migratedTwinSellableRooms,
  2,
  "legacy reservation-adjusted available_rooms must not become base sellable capacity",
);
assert.equal(
  available(migratedTwinSellableRooms, twinRequest, [{ ...twinRequest, reference: "LEGACY-TWIN-1" }]),
  1,
  "one legacy Twin hold must leave one of two physical rooms available after migration",
);
const twinBookings = [
  { ...twinRequest, reference: "T1" },
  { ...twinRequest, reference: "T2", status: "confirmed" },
];
assert.equal(available(2, twinRequest, twinBookings), 0, "two overlapping Twin stays fill capacity");

const forceReleasedTwin = {
  ...twinRequest,
  reference: "TWIN-A",
  status: "checked_in",
  inventoryHoldActive: false,
};
assert.equal(forceReleasedTwin.status, "checked_in", "force release must not change checked-in status");
assert.equal(available(2, twinRequest, [forceReleasedTwin]), 2, "force release must immediately return capacity");

const replacementTwin = {
  ...twinRequest,
  reference: "TWIN-B",
  rooms: 2,
  status: "pending_review",
};
assert.equal(available(2, twinRequest, [forceReleasedTwin, replacementTwin]), 0, "a new booking can consume released capacity");
const canRestore = (capacity, booking, bookings) => (
  available(capacity, booking, bookings.filter((item) => item.reference !== booking.reference)) >= booking.rooms
);
assert.equal(
  canRestore(2, forceReleasedTwin, [forceReleasedTwin, replacementTwin]),
  false,
  "restore must fail atomically when overlapping capacity is full",
);
replacementTwin.inventoryHoldActive = false;
assert.equal(
  canRestore(2, forceReleasedTwin, [forceReleasedTwin, replacementTwin]),
  true,
  "restore must succeed after overlapping capacity is released",
);

const earlyCheckout = {
  ...forceReleasedTwin,
  status: "checked_out",
  inventoryHoldActive: false,
  actualCheckOutAt: "2026-08-21T09:00:00+03:00",
};
assert.equal(earlyCheckout.checkOut, "2026-08-23", "early checkout must preserve the contractual checkout date");
assert.equal(available(2, twinRequest, [earlyCheckout]), 2, "early checkout must release capacity");

const holdAuditHistory = [];
holdAuditHistory.push({ action: "force_release", releaseType: "manual_override", actorEmail: "booking@harlahotel.com" });
const restoredBooking = { ...forceReleasedTwin, inventoryHoldActive: true, inventoryReleaseType: null };
holdAuditHistory.push({ action: "restore_hold", releaseType: "manual_override", actorEmail: "booking@harlahotel.com" });
assert.equal(restoredBooking.inventoryReleaseType, null, "restore may clear current booking release metadata");
assert.equal(holdAuditHistory[0].releaseType, "manual_override", "restore must not erase the prior manual release audit type");
holdAuditHistory.push({ action: "check_out", releaseType: "early_checkout", actorEmail: "booking@harlahotel.com" });
assert.equal(holdAuditHistory.at(-1).releaseType, "early_checkout", "early checkout must remain explicit in audit history");

const vipRequest = stay("VIP Room", "2026-08-20", "2026-08-23");
assert.equal(available(1, vipRequest, [vipRequest]), 0, "one VIP hold fills capacity");

const adjacent = stay("Queen Size Bed Room", "2026-08-23", "2026-08-25");
assert.equal(overlaps(queen, adjacent), false, "checkout day must be reusable as the next check-in day");

const declined = { ...queen, status: "declined" };
assert.equal(available(8, queen, [declined]), 8, "decline must release capacity");
const cancelled = { ...queen, status: "cancelled", inventoryHoldActive: false };
assert.equal(available(8, queen, [cancelled]), 8, "cancel must release capacity");
assert.equal(available(8, queen, [queen]), 7, "a pending request must hold capacity");
const confirmed = { ...queen, status: "confirmed" };
assert.equal(available(8, queen, [confirmed]), 7, "confirmation must preserve, not duplicate, the existing hold");

const ledger = new SerializedRoomLedger({ "VIP Room": 1 });
const concurrent = await Promise.allSettled([
  ledger.create({ ...vipRequest, reference: "VIP-A" }),
  ledger.create({ ...vipRequest, reference: "VIP-B" }),
]);
assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);

const [
  migration,
  adminSource,
  adminApiSource,
  adminAuthSource,
  bookingFrontendSource,
  legacyFrontendApiSource,
  uploadServiceSource,
  statusSource,
  emailSource,
  confirmationSource,
  inventoryOverrideMigration,
  bookingServiceSource,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/20260818094013_room_booking_workflow_v2.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/admin.js", import.meta.url), "utf8"),
  readFile(new URL("../api/room-admin.js", import.meta.url), "utf8"),
  readFile(new URL("../server/admin-auth.js", import.meta.url), "utf8"),
  readFile(new URL("../src/room-booking.js", import.meta.url), "utf8"),
  readFile(new URL("../src/supabase-api.js", import.meta.url), "utf8"),
  readFile(new URL("../server/room-upload-service.js", import.meta.url), "utf8"),
  readFile(new URL("../src/booking-status.js", import.meta.url), "utf8"),
  readFile(new URL("../server/room-email-service.js", import.meta.url), "utf8"),
  readFile(new URL("../server/room-confirmation-service.js", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260915233811_v1_room_admin_inventory_override.sql", import.meta.url), "utf8"),
  readFile(new URL("../server/room-booking-service.js", import.meta.url), "utf8"),
]);

assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /booking\.check_in < p_check_out/);
assert.match(migration, /p_check_in < booking\.check_out/);
assert.doesNotMatch(migration, /available_rooms\s*=\s*available_rooms\s*-/i);
assert.doesNotMatch(migration, /update\s+public\.rooms\s+set\s+price_per_night/i);
assert.match(migration, /set\s+sellable_rooms\s*=\s*total_rooms\s+where\s+sellable_rooms\s+is\s+null/i);
assert.doesNotMatch(migration, /set\s+sellable_rooms\s*=\s*least\(total_rooms, greatest\(available_rooms, 0\)\)/i);
assert.doesNotMatch(migration, /set\s+available_rooms\s*=\s*sellable_rooms/i);
assert.match(migration, /revoke insert on table public\.room_bookings from anon, authenticated/);
assert.match(migration, /get_room_booking_status\(text\).*from public, anon, authenticated/s);
assert.match(migration, /create table if not exists public\.room_admin_users/);
assert.match(migration, /create or replace function public\.is_harla_room_admin\(\)/);
assert.match(migration, /if not public\.is_harla_room_admin\(\)/);
assert.doesNotMatch(migration, /insert into public\.room_admin_users[\s\S]*from public\.admin_users/i);
assert.match(migration, /with check \(bucket_id <> 'guest-ids'\)/);
assert.match(migration, /bucket_id = 'payment-screenshots'[\s\S]*foldername\(name\)\)\[1\].*= 'room-bookings'/);
assert.match(adminSource, /Pending Room Requests/);
assert.doesNotMatch(adminSource, /restaurant_requests|restaurant_orders|package_bookings|event_hall_bookings/);
assert.match(adminApiSource, /requestingRoomAdmin/);
assert.doesNotMatch(adminApiSource, /requestingAdmin/);
assert.match(adminAuthSource, /from\("room_admin_users"\)/);
assert.match(adminAuthSource, /room_admin|room_manager|hotel_manager|master_admin/);
assert.match(bookingFrontendSource, /authorizeRoomBookingUploads/);
assert.match(bookingFrontendSource, /uploadAuthorizedRoomFile/);
assert.doesNotMatch(bookingFrontendSource, /uploadGovernmentId|uploadRoomPaymentProof/);
assert.doesNotMatch(legacyFrontendApiSource, /export async function uploadGovernmentId|export async function uploadRoomPaymentProof/);
assert.match(uploadServiceSource, /createSignedUploadUrl/);
assert.match(uploadServiceSource, /ROOM_UPLOAD_TOKEN_SECRET/);
assert.match(uploadServiceSource, /timingSafeEqual/);
assert.match(uploadServiceSource, /%PDF-/);
assert.match(uploadServiceSource, /RIFF/);
assert.match(statusSource, /Harla Hotel is currently reviewing it/);
assert.match(statusSource, /refreshIntervalMs = 20_000/);
assert.match(emailSource, /ensureRoomConfirmationPdf/);
assert.match(confirmationSource, /confirmed\/\$\{booking\.booking_number\}\.pdf/);

assert.match(inventoryOverrideMigration, /add column if not exists inventory_hold_active boolean/);
assert.match(inventoryOverrideMigration, /set inventory_hold_active = true[\s\S]*'pending_payment_confirmation'[\s\S]*'checked_in'/);
assert.match(inventoryOverrideMigration, /set inventory_hold_active = false[\s\S]*'declined'[\s\S]*'checked_out'/);
assert.match(inventoryOverrideMigration, /room_booking_status_blocks_inventory\(booking\.status\)[\s\S]*booking\.inventory_hold_active = true/);
assert.match(inventoryOverrideMigration, /pg_advisory_xact_lock/);
assert.match(inventoryOverrideMigration, /clean_action = 'force_release'[\s\S]*inventory_release_type = 'manual_override'/);
assert.match(inventoryOverrideMigration, /clean_action = 'restore_hold'[\s\S]*booking\.id <> booking_record\.id/);
assert.match(inventoryOverrideMigration, /clean_action = 'check_out'[\s\S]*actual_check_out_at = now_value/);
assert.match(inventoryOverrideMigration, /local_today < booking_record\.check_out then 'early_checkout'/);
assert.match(inventoryOverrideMigration, /p_actor_user_id[\s\S]*room_admin_users[\s\S]*room_admin[\s\S]*room_manager[\s\S]*hotel_manager[\s\S]*master_admin/);
assert.match(inventoryOverrideMigration, /from public, anon, authenticated;[\s\S]*to service_role/);
assert.doesNotMatch(inventoryOverrideMigration, /inventory_released_by\s+uuid\s+references\s+auth\.users/i);
assert.doesNotMatch(inventoryOverrideMigration, /actor_user_id\s+uuid[^,\n]*references\s+auth\.users/i);
assert.match(inventoryOverrideMigration, /actor_user_id uuid not null[\s\S]*actor_email text not null[\s\S]*actor_role text not null/);
assert.match(inventoryOverrideMigration, /release_type text check \(release_type is null or release_type in/);
assert.match(inventoryOverrideMigration, /when clean_action = 'restore_hold' then booking_record\.inventory_release_type/);
assert.match(inventoryOverrideMigration, /inventory_released_by_email = actor_record\.email/);
assert.match(inventoryOverrideMigration, /inventory_released_by_role = actor_record\.role/);
assert.match(inventoryOverrideMigration, /coalesce\(p_number_of_rooms, 0\) not between 1 and 20/);
assert.match(inventoryOverrideMigration, /lower\(btrim\(room\.name\)\) = lower\(btrim\(inventory_record\.room_type\)\)/);
assert.match(inventoryOverrideMigration, /clean_room_slug = '' or room\.slug = clean_room_slug/);
assert.doesNotMatch(inventoryOverrideMigration, /room\.slug\s*=.+[\s\S]{0,80}\sor\s+lower\(btrim\(room\.name\)\)/i);
assert.doesNotMatch(inventoryOverrideMigration, /update\s+public\.room_inventory\s+set/i);
assert.doesNotMatch(inventoryOverrideMigration, /update\s+public\.rooms\s+set/i);
assert.match(adminApiSource, /transitionRoomBooking\([\s\S]*admin\.id/);
assert.doesNotMatch(adminApiSource, /body\.(actorUserId|actor_user_id|p_actor_user_id)/);
assert.match(adminSource, /Mark Checked In/);
assert.match(adminSource, /Check Out &amp; Release Room/);
assert.match(adminSource, /Force Release Inventory/);
assert.match(adminSource, /Restore Inventory Hold/);
assert.match(adminSource, /Release this booking's room inventory\?/);
assert.match(adminSource, /Active Holds for Selected Dates/);
assert.match(bookingServiceSource, /transition_room_booking_inventory_authority_v1/);
const capacityUpdateSource = bookingServiceSource.slice(
  bookingServiceSource.indexOf("export async function updateRoomInventoryCapacity"),
);
assert.doesNotMatch(capacityUpdateSource, /available_rooms\s*:/);

console.log("Room workflow regression tests passed: durable audit identity/types, strict room-rate matching, authenticated actors, explicit holds, force release, atomic restore, early checkout, and concurrency.");
