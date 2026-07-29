import { randomBytes } from "node:crypto";
import { validateChapaBooking } from "../server/booking-validation.js";
import {
  getChapaMode,
  initializeChapaTransaction,
} from "../server/chapa-client.js";
import { PublicError, publicErrorResponse } from "../server/errors.js";
import { getSupabaseAdmin } from "../server/supabase-admin.js";

async function requestJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new PublicError("This endpoint accepts JSON only.", 415);
  }

  try {
    return await request.json();
  } catch {
    throw new PublicError("The Chapa checkout request is not valid JSON.");
  }
}

function checkoutUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (
      url.protocol === "https:" &&
      (url.hostname === "chapa.co" || url.hostname.endsWith(".chapa.co"))
    ) {
      return url.href;
    }
  } catch {
    // Invalid URLs are handled by the public error below.
  }
  throw new PublicError(
    "Chapa did not return a valid secure checkout URL.",
    502,
    "chapa_checkout_url_invalid",
  );
}

function etbAmount(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new PublicError("The server-calculated room total is invalid.");
  }
  return amount;
}

function customerNames(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || "Guest",
    lastName: parts.join(" "),
  };
}

function ethiopianChapaPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^0[79]\d{8}$/.test(digits)) {
    return digits;
  }
  if (/^251[79]\d{8}$/.test(digits)) {
    return `0${digits.slice(3)}`;
  }
  return "";
}

function createTxRef(mode) {
  const prefix = mode === "test" ? "HRL-CHAPA-TEST" : "HRL-CHAPA-LIVE";
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(16).toString("hex").toUpperCase()}`;
}

function matchesExistingBooking(existing, booking) {
  return (
    existing.email?.toLowerCase() === booking.email &&
    existing.phone === booking.phone &&
    existing.room_type === booking.room.name
  );
}

async function requireAvailableRoom(roomName) {
  const { data, error } = await getSupabaseAdmin()
    .from("room_inventory")
    .select("room_type,total_rooms,available_rooms")
    .eq("room_type", roomName)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data || Number(data.available_rooms) < 1) {
    throw new PublicError(
      `${roomName} is no longer available. Please choose another room or contact Harla Hotel.`,
      409,
      "room_unavailable",
    );
  }
  return data;
}

function reusableCheckout(existing, mode, totalEtb) {
  if (
    !existing ||
    existing.payment_method !== "Chapa" ||
    existing.chapa_payment_mode !== mode ||
    !["initialized", "pending"].includes(existing.chapa_payment_status) ||
    Number(existing.total_price_etb) !== totalEtb
  ) {
    return null;
  }

  try {
    return {
      bookingNumber: existing.booking_number,
      txRef: existing.chapa_tx_ref,
      checkoutUrl: checkoutUrl(existing.chapa_checkout_url),
    };
  } catch {
    return null;
  }
}

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return Response.json(
        { error: "Method not allowed." },
        { status: 405, headers: { Allow: "POST" } },
      );
    }

    let bookingRecord;
    try {
      const booking = validateChapaBooking(await requestJson(request));
      const supabase = getSupabaseAdmin();
      const mode = getChapaMode();
      const origin = new URL(request.url).origin;

      await requireAvailableRoom(booking.room.name);
      const totalEtb = etbAmount(
        booking.room.pricePerNightEtb * booking.nights,
      );

      const { data: existing, error: existingError } = await supabase
        .from("room_bookings")
        .select(
          "id,booking_number,email,phone,room_type,payment_method,status,payment_status,total_price_etb,chapa_tx_ref,chapa_checkout_url,chapa_payment_status,chapa_payment_mode",
        )
        .eq("booking_number", booking.bookingNumber)
        .maybeSingle();

      if (existingError) {
        throw existingError;
      }
      if (existing && !matchesExistingBooking(existing, booking)) {
        throw new PublicError(
          "This booking reference is already in use. Please restart checkout.",
          409,
          "booking_reference_conflict",
        );
      }
      if (existing?.status === "confirmed" || existing?.payment_status === "paid") {
        throw new PublicError(
          "This booking is already confirmed.",
          409,
          "booking_already_confirmed",
        );
      }
      if (
        existing?.payment_method &&
        existing.payment_method !== "Chapa"
      ) {
        throw new PublicError(
          "This booking reference belongs to another payment method. Please restart checkout.",
          409,
          "booking_payment_conflict",
        );
      }

      const reusable = reusableCheckout(existing, mode, totalEtb);
      if (reusable) {
        return Response.json(reusable);
      }

      const txRef = createTxRef(mode);
      const initializedAt = new Date().toISOString();
      const bookingValues = {
        booking_number: booking.bookingNumber,
        full_name: booking.fullName,
        phone: booking.phone,
        email: booking.email,
        date_of_birth: booking.dateOfBirth,
        nationality: booking.nationality,
        room_type: booking.room.name,
        room_slug: booking.room.slug,
        room_name: booking.room.name,
        check_in: booking.checkIn,
        check_out: booking.checkOut,
        nights: booking.nights,
        guests: booking.guests,
        number_of_rooms: 1,
        price_per_night: booking.room.pricePerNightEtb,
        total_price: totalEtb,
        total_price_etb: totalEtb,
        total_price_usd: null,
        exchange_rate: null,
        exchange_rate_date: null,
        payment_currency: "ETB",
        payment_method: "Chapa",
        payment_reference: null,
        payment_screenshot_url: null,
        payment_status: "pending_payment_confirmation",
        status: "pending",
        message: booking.message,
        government_id_path: booking.governmentIdPath,
        government_id_file_name: booking.governmentIdFileName,
        government_id_mime_type: booking.governmentIdMimeType,
        government_id_file_size: booking.governmentIdFileSize,
        government_id_uploaded_at: booking.governmentIdUploadedAt,
        chapa_tx_ref: txRef,
        chapa_reference: null,
        chapa_payment_status: "initialized",
        chapa_checkout_url: null,
        chapa_payment_mode: mode,
        chapa_initialized_at: initializedAt,
        chapa_verified_at: null,
        is_test_booking: mode === "test",
      };

      if (existing) {
        const { data, error } = await supabase
          .from("room_bookings")
          .update(bookingValues)
          .eq("id", existing.id)
          .eq("status", "pending")
          .select("id,booking_number")
          .single();
        if (error) {
          throw error;
        }
        bookingRecord = data;
      } else {
        const { data, error } = await supabase
          .from("room_bookings")
          .insert(bookingValues)
          .select("id,booking_number")
          .single();
        if (error) {
          throw error;
        }
        bookingRecord = data;
      }

      const names = customerNames(booking.fullName);
      const phoneNumber = ethiopianChapaPhone(booking.phone);
      const callbackUrl = `${origin}/api/chapa-callback`;
      const returnUrl = `${origin}/chapa-success.html?tx_ref=${encodeURIComponent(txRef)}&booking=${encodeURIComponent(booking.bookingNumber)}`;
      const payload = {
        amount: totalEtb.toFixed(2),
        currency: "ETB",
        email: booking.email,
        first_name: names.firstName,
        tx_ref: txRef,
        callback_url: callbackUrl,
        return_url: returnUrl,
        customization: {
          title: "Harla Hotel Booking",
          description: `${booking.room.name} · ${booking.bookingNumber}`,
        },
        meta: {
          booking_number: booking.bookingNumber,
          room_name: booking.room.name,
          nights: booking.nights,
          check_in: booking.checkIn,
          check_out: booking.checkOut,
        },
      };

      if (names.lastName) {
        payload.last_name = names.lastName;
      }
      if (phoneNumber) {
        payload.phone_number = phoneNumber;
      }

      let initialization;
      try {
        initialization = await initializeChapaTransaction(payload);
      } catch (error) {
        await supabase
          .from("room_bookings")
          .update({ chapa_payment_status: "failed" })
          .eq("id", bookingRecord.id);
        throw error;
      }

      if (
        String(initialization.status || "").toLowerCase() !== "success"
      ) {
        await supabase
          .from("room_bookings")
          .update({ chapa_payment_status: "failed" })
          .eq("id", bookingRecord.id);
        throw new PublicError(
          "Chapa could not initialize the secure checkout.",
          502,
          "chapa_initialize_failed",
        );
      }

      const secureCheckoutUrl = checkoutUrl(
        initialization.data?.checkout_url,
      );
      const { error: checkoutUpdateError } = await supabase
        .from("room_bookings")
        .update({
          chapa_checkout_url: secureCheckoutUrl,
          chapa_payment_status: "initialized",
        })
        .eq("id", bookingRecord.id)
        .eq("chapa_tx_ref", txRef);

      if (checkoutUpdateError) {
        throw checkoutUpdateError;
      }

      return Response.json(
        {
          bookingNumber: booking.bookingNumber,
          txRef,
          checkoutUrl: secureCheckoutUrl,
        },
        { status: 201 },
      );
    } catch (error) {
      return publicErrorResponse(error);
    }
  },
};
