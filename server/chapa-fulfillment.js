import {
  getChapaMode,
  verifyChapaTransaction,
} from "./chapa-client.js";
import { PublicError } from "./errors.js";
import { getSupabaseAdmin } from "./supabase-admin.js";

const safeBookingFields = [
  "booking_number",
  "full_name",
  "room_type",
  "check_in",
  "check_out",
  "nights",
  "guests",
  "total_price_etb",
  "payment_currency",
  "payment_method",
  "payment_status",
  "status",
  "is_test_booking",
  "chapa_payment_status",
  "chapa_payment_mode",
].join(",");

function normalizedText(value) {
  return String(value ?? "").trim();
}

function normalizedStatus(value) {
  return normalizedText(value).toLowerCase();
}

function decimalMinorUnits(value) {
  const text =
    typeof value === "number" && Number.isFinite(value)
      ? value.toFixed(2)
      : normalizedText(value);
  const match = text.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) {
    return null;
  }
  const fraction = match[2] || "";
  if (fraction.slice(2).replaceAll("0", "")) {
    return null;
  }
  return BigInt(match[1]) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, "0"));
}

function chapaTransaction(response) {
  const data =
    response?.data && typeof response.data === "object"
      ? response.data
      : null;
  if (!data) {
    throw new PublicError(
      "Chapa returned incomplete verification details.",
      502,
      "chapa_invalid_verification",
    );
  }

  return {
    apiStatus: normalizedStatus(response.status),
    paymentStatus: normalizedStatus(data.status),
    txRef: normalizedText(data.tx_ref || data.trx_ref),
    reference: normalizedText(data.reference || data.ref_id),
    currency: normalizedText(data.currency).toUpperCase(),
    amount: data.amount,
    mode: normalizedStatus(data.mode),
  };
}

function safeConfirmation(booking) {
  return {
    confirmed:
      booking.status === "confirmed" && booking.payment_status === "paid",
    paymentStatus:
      booking.chapa_payment_status || booking.payment_status || "pending",
    bookingNumber: booking.booking_number,
    customerName: booking.full_name,
    roomName: booking.room_type,
    checkIn: booking.check_in,
    checkOut: booking.check_out,
    nights: booking.nights,
    guests: booking.guests,
    amount: Number(booking.total_price_etb),
    currency: booking.payment_currency || "ETB",
    paymentMethod: booking.payment_method || "Chapa",
    isTestBooking: Boolean(booking.is_test_booking),
  };
}

async function getBookingByTxRef(txRef, fields = `id,${safeBookingFields}`) {
  const { data, error } = await getSupabaseAdmin()
    .from("room_bookings")
    .select(fields)
    .eq("chapa_tx_ref", txRef)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new PublicError(
      "The Chapa booking transaction could not be found.",
      404,
      "chapa_booking_not_found",
    );
  }
  return data;
}

async function updateChapaState(bookingId, status, reference = "") {
  const updates = {
    chapa_payment_status: status,
  };
  if (reference) {
    updates.chapa_reference = reference;
  }

  const { error } = await getSupabaseAdmin()
    .from("room_bookings")
    .update(updates)
    .eq("id", bookingId)
    .neq("status", "confirmed");

  if (error) {
    throw error;
  }
}

export async function fulfillChapaTransaction(txRef) {
  const reference = normalizedText(txRef);
  if (!/^[A-Za-z0-9._-]{8,120}$/.test(reference)) {
    throw new PublicError(
      "A valid Chapa transaction reference is required.",
      400,
      "invalid_chapa_reference",
    );
  }

  const booking = await getBookingByTxRef(reference);
  if (booking.status === "confirmed" && booking.payment_status === "paid") {
    return safeConfirmation(booking);
  }

  const configuredMode = getChapaMode();
  const verified = chapaTransaction(
    await verifyChapaTransaction(reference),
  );

  if (verified.paymentStatus !== "success") {
    const safeStatus = ["failed", "cancelled"].includes(verified.paymentStatus)
      ? verified.paymentStatus
      : "pending";
    await updateChapaState(booking.id, safeStatus, verified.reference);
    return {
      ...safeConfirmation({
        ...booking,
        chapa_payment_status: safeStatus,
      }),
      confirmed: false,
      paymentStatus: safeStatus,
    };
  }

  if (verified.apiStatus !== "success") {
    throw new PublicError(
      "Chapa did not confirm this transaction.",
      409,
      "chapa_not_confirmed",
    );
  }
  if (verified.txRef !== booking.chapa_tx_ref) {
    throw new PublicError(
      "Chapa transaction verification did not match this booking.",
      409,
      "chapa_reference_mismatch",
    );
  }
  if (verified.currency !== "ETB") {
    throw new PublicError(
      "Chapa transaction currency verification failed.",
      409,
      "chapa_currency_mismatch",
    );
  }

  const expectedAmount = decimalMinorUnits(booking.total_price_etb);
  const verifiedAmount = decimalMinorUnits(verified.amount);
  if (
    expectedAmount === null ||
    verifiedAmount === null ||
    expectedAmount !== verifiedAmount
  ) {
    throw new PublicError(
      "Chapa transaction amount verification failed.",
      409,
      "chapa_amount_mismatch",
    );
  }
  if (
    verified.mode !== configuredMode ||
    normalizedStatus(booking.chapa_payment_mode) !== configuredMode
  ) {
    throw new PublicError(
      "Chapa transaction mode verification failed.",
      409,
      "chapa_mode_mismatch",
    );
  }
  if (
    (configuredMode === "test" && !booking.is_test_booking) ||
    (configuredMode === "live" && booking.is_test_booking)
  ) {
    throw new PublicError(
      "Chapa test/live booking verification failed.",
      409,
      "chapa_test_booking_mismatch",
    );
  }
  if (!verified.reference) {
    throw new PublicError(
      "Chapa did not return its verified transaction reference.",
      502,
      "chapa_reference_missing",
    );
  }

  const { error: confirmationError } = await getSupabaseAdmin().rpc(
    "confirm_chapa_room_booking",
    {
      p_booking_id: booking.id,
      p_tx_ref: reference,
      p_chapa_reference: verified.reference,
      p_payment_mode: configuredMode,
    },
  );

  if (confirmationError) {
    if (String(confirmationError.message || "").includes("NO_ROOM_AVAILABLE")) {
      throw new PublicError(
        "The selected room is no longer available. Please contact Harla Hotel.",
        409,
        "room_unavailable",
      );
    }
    throw confirmationError;
  }

  return safeConfirmation(
    await getBookingByTxRef(reference, safeBookingFields),
  );
}
