import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { requiredEnv, siteUrl } from "./config.js";

export const EVENT_STATUSES = Object.freeze([
  "pending_review",
  "needs_information",
  "approved_awaiting_payment",
  "payment_submitted",
  "confirmed",
  "completed",
  "rejected",
  "cancelled",
]);

export const BLOCKING_EVENT_STATUSES = Object.freeze([
  "approved_awaiting_payment",
  "payment_submitted",
  "confirmed",
]);

export const EVENT_SOURCES = Object.freeze([
  "WEBSITE",
  "WALK_IN",
  "PHONE",
  "ADMIN_OTHER",
]);

export const EVENT_STATUS_LABELS = Object.freeze({
  pending_review: "Request Received - Pending Review",
  needs_information: "Additional Information Required",
  approved_awaiting_payment: "Approved - Awaiting Payment",
  payment_submitted: "Payment Submitted - Awaiting Verification",
  confirmed: "Booking Confirmed",
  completed: "Event Completed",
  rejected: "Request Not Available",
  cancelled: "Reservation Cancelled",
});

const allowedTransitions = Object.freeze({
  pending_review: new Set(["needs_information", "approved_awaiting_payment", "rejected", "cancelled"]),
  needs_information: new Set(["pending_review", "approved_awaiting_payment", "rejected", "cancelled"]),
  approved_awaiting_payment: new Set(["payment_submitted", "needs_information", "rejected", "cancelled"]),
  payment_submitted: new Set(["approved_awaiting_payment", "confirmed", "rejected", "cancelled"]),
  confirmed: new Set(["completed", "cancelled"]),
  completed: new Set(),
  rejected: new Set(["pending_review"]),
  cancelled: new Set(["pending_review"]),
});

export function cleanText(value) {
  return String(value ?? "").trim();
}

export function normalizeEventStatus(value) {
  const normalized = cleanText(value).toLowerCase();
  return normalized === "pending" ? "pending_review" : normalized;
}

export function eventStatusLabel(value) {
  const status = normalizeEventStatus(value);
  return EVENT_STATUS_LABELS[status] || "Status Unavailable";
}

export function assertEventTransition(current, next) {
  const currentStatus = normalizeEventStatus(current);
  const nextStatus = normalizeEventStatus(next);
  if (currentStatus === nextStatus) {
    return nextStatus;
  }
  if (!allowedTransitions[currentStatus]?.has(nextStatus)) {
    throw new Error(`The event request cannot move from ${currentStatus} to ${nextStatus}.`);
  }
  return nextStatus;
}

function dateStartUtc(value) {
  const match = cleanText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return timestamp;
}

function timeMinutes(value) {
  const match = cleanText(value).match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return (hour * 60) + minute;
}

export function eventSlotRange(slot) {
  const dayStart = dateStartUtc(slot?.eventDate);
  const startMinutes = timeMinutes(slot?.startTime);
  const endMinutes = timeMinutes(slot?.endTime);
  if (dayStart === null || startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
    return null;
  }
  const start = dayStart + (startMinutes * 60_000);
  const overnight = endMinutes < startMinutes;
  const end = dayStart + (endMinutes * 60_000) + (overnight ? 86_400_000 : 0);
  return { start, end, overnight };
}

export function slotsOverlap(left, right) {
  if (String(left.hallId) !== String(right.hallId)) return false;
  const leftRange = eventSlotRange(left);
  const rightRange = eventSlotRange(right);
  if (!leftRange || !rightRange) return false;
  return leftRange.start < rightRange.end && rightRange.start < leftRange.end;
}

export function hashPortalToken(token) {
  const value = cleanText(token);
  if (!value) {
    throw new Error("A customer portal token is required.");
  }
  return createHash("sha256").update(value).digest("hex");
}

export function initialPortalToken(submissionToken) {
  const signingSecret = requiredEnv("EVENT_PORTAL_TOKEN_SECRET");
  if (signingSecret.length < 32) {
    throw new Error("EVENT_PORTAL_TOKEN_SECRET must contain at least 32 characters.");
  }
  return createHmac("sha256", signingSecret)
    .update(`event-request:${cleanText(submissionToken)}`)
    .digest("base64url");
}

export function rotatePortalToken() {
  return randomBytes(32).toString("base64url");
}

export function matchesPortalToken(storedHash, token) {
  const expected = Buffer.from(cleanText(storedHash), "utf8");
  const actual = Buffer.from(hashPortalToken(token), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function customerPortalUrl(reference, token) {
  const url = new URL("/event-request.html", siteUrl());
  url.searchParams.set("reference", cleanText(reference).toUpperCase());
  url.searchParams.set("token", cleanText(token));
  return url.toString();
}

export function safeFileName(value, fallback = "payment-proof") {
  const cleaned = cleanText(value)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

export function validatePaymentProof(file) {
  if (!file || typeof file.arrayBuffer !== "function" || !file.name) {
    throw new Error("Please upload the payment confirmation.");
  }
  const extension = cleanText(file.name).split(".").pop()?.toLowerCase();
  const allowed = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  if (!allowed[extension] || file.type !== allowed[extension]) {
    throw new Error("Payment confirmation must be JPG, JPEG, PNG, or WebP.");
  }
  if (file.size < 1 || file.size > 5 * 1024 * 1024) {
    throw new Error("Payment confirmation must be 5 MB or smaller.");
  }
  return { extension, mimeType: allowed[extension] };
}

export function publicEventRecord(booking, signedPdfUrl = "") {
  return {
    bookingReference: booking.booking_reference,
    clientFullName: booking.client_full_name,
    organization: booking.organization,
    hallName: booking.hall_name,
    hallType: booking.hall_type,
    eventType: booking.event_type,
    customEventType: booking.custom_event_type,
    eventDate: booking.event_date,
    startTime: booking.start_time,
    endTime: booking.end_time,
    attendees: booking.attendees,
    refreshmentsServices: booking.refreshments_services,
    specialRequests: booking.special_requests,
    status: normalizeEventStatus(booking.status),
    statusLabel: eventStatusLabel(booking.status),
    needsInformationMessage: booking.needs_information_message,
    declineReason: booking.decline_reason,
    quotedAmount: booking.quoted_amount,
    quotedCurrency: booking.quoted_currency,
    paymentInstructions: booking.payment_instructions,
    paymentDeadline: booking.payment_deadline,
    paymentStatus: booking.payment_status,
    paymentReference: booking.payment_reference,
    confirmationPdfUrl: signedPdfUrl,
    createdAt: booking.created_at,
    updatedAt: booking.updated_at,
  };
}
