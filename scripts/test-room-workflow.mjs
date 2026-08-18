import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
});

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

const vipRequest = stay("VIP Room", "2026-08-20", "2026-08-23");
assert.equal(available(1, vipRequest, [vipRequest]), 0, "one VIP hold fills capacity");

const adjacent = stay("Queen Size Bed Room", "2026-08-23", "2026-08-25");
assert.equal(overlaps(queen, adjacent), false, "checkout day must be reusable as the next check-in day");

const declined = { ...queen, status: "declined" };
assert.equal(available(8, queen, [declined]), 8, "decline must release capacity");
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

console.log("Room workflow regression tests passed: capacity, pricing/inventory migration safety, role separation, signed upload architecture, adjacency, release, no double decrement, and concurrency model.");
