import { PublicError } from "./errors.js";
import {
  cleanRoomText,
  normalizeGuestName,
  normalizeRoomStatus,
  roomBookingNumberPattern,
  safeRoomBookingRecord,
  validateRoomBookingRequest,
  validateStayDates,
} from "./room-workflow.js";

const confirmationBucket = "room-confirmations";
const paymentBucket = "payment-screenshots";
const guestIdBucket = "guest-ids";
const signedUrlLifetimeSeconds = 15 * 60;

function unavailableError() {
  return new PublicError(
    "This room is no longer available for the selected dates. Please choose another room or contact Harla Hotel.",
    409,
    "room_unavailable",
  );
}

export async function roomAvailabilityForDates(supabase, checkInValue, checkOutValue) {
  const { checkIn, checkOut } = validateStayDates(checkInValue, checkOutValue);
  const { data, error } = await supabase.rpc("get_room_availability_for_dates", {
    p_check_in: checkIn,
    p_check_out: checkOut,
  });
  if (error) {
    if (error.code === "PGRST202" || /get_room_availability_for_dates/i.test(error.message || "")) {
      throw new PublicError(
        "Online room reservations need the Room Booking Workflow V2 Supabase migration before submission.",
        503,
        "room_migration_required",
      );
    }
    throw error;
  }
  return (data || []).map((room) => ({
    room_slug: room.room_slug,
    room_type: room.room_type,
    price_per_night: Number(room.price_per_night || 0),
    total_rooms: Number(room.total_rooms || 0),
    sellable_rooms: Number(room.sellable_rooms || 0),
    held_rooms: Number(room.held_rooms || 0),
    available_rooms: Number(room.available_rooms || 0),
  }));
}

async function removeOrphanedUploads(supabase, booking) {
  const removals = [];
  if (booking.paymentScreenshotPath) {
    removals.push(
      supabase.storage.from(paymentBucket).remove([booking.paymentScreenshotPath]),
    );
  }
  if (booking.governmentIdPath) {
    removals.push(
      supabase.storage.from(guestIdBucket).remove([booking.governmentIdPath]),
    );
  }
  const results = await Promise.allSettled(removals);
  results.forEach((result) => {
    if (result.status === "rejected" || result.value?.error) {
      console.error("Room booking orphaned upload cleanup failed", {
        bookingReference: booking.bookingNumber,
        message: result.reason?.message || result.value?.error?.message || "storage cleanup failed",
      });
    }
  });
}

export async function createRoomBookingRecord(supabase, input) {
  const booking = validateRoomBookingRequest(input);
  const rpcPayload = {
    p_booking_number: booking.bookingNumber,
    p_full_name: booking.fullName,
    p_phone: booking.phone,
    p_email: booking.email,
    p_date_of_birth: booking.dateOfBirth,
    p_nationality: booking.nationality,
    p_room_type: booking.room.name,
    p_room_slug: booking.room.slug,
    p_check_in: booking.checkIn,
    p_check_out: booking.checkOut,
    p_guests: booking.guests,
    p_number_of_rooms: booking.numberOfRooms,
    p_payment_method: booking.paymentMethod,
    p_payment_reference: booking.paymentReference,
    p_payment_screenshot_url: booking.paymentScreenshotPath,
    p_payment_status: booking.paymentStatus,
    p_payment_currency: booking.paymentCurrency,
    p_total_price_usd: booking.totalPriceUsd,
    p_exchange_rate: booking.exchangeRate,
    p_exchange_rate_date: booking.exchangeRateDate,
    p_message: booking.message,
    p_government_id_path: booking.governmentIdPath,
    p_government_id_file_name: booking.governmentIdFileName,
    p_government_id_mime_type: booking.governmentIdMimeType,
    p_government_id_file_size: booking.governmentIdFileSize,
    p_government_id_uploaded_at: booking.governmentIdUploadedAt,
  };

  const { data, error } = await supabase.rpc("create_room_booking_with_hold", rpcPayload);
  if (error) {
    const unavailable = error.code === "P0001" || /no longer available|capacity|unavailable/i.test(error.message || "");
    const missingMigration = error.code === "PGRST202" || /create_room_booking_with_hold/i.test(error.message || "");
    await removeOrphanedUploads(supabase, booking);
    if (unavailable) throw unavailableError();
    if (missingMigration) {
      throw new PublicError(
        "Online room reservations need the Room Booking Workflow V2 Supabase migration before submission.",
        503,
        "room_migration_required",
      );
    }
    throw error;
  }

  const created = Array.isArray(data) ? data[0] : data;
  if (!created?.booking_number) {
    throw new Error("The room booking was saved without a booking reference.");
  }
  return {
    bookingNumber: created.booking_number,
    status: created.status,
    availableRooms: Number(created.available_rooms ?? 0),
  };
}

export async function roomBookingForCustomer(supabase, bookingNumberValue, fullNameValue) {
  const bookingNumber = cleanRoomText(bookingNumberValue).toUpperCase();
  const fullName = cleanRoomText(fullNameValue);
  if (!roomBookingNumberPattern.test(bookingNumber) || fullName.length < 2 || fullName.length > 160) {
    return null;
  }

  const { data, error } = await supabase
    .from("room_bookings")
    .select("*")
    .eq("booking_number", bookingNumber)
    .maybeSingle();
  if (error) throw error;
  if (!data || normalizeGuestName(data.full_name) !== normalizeGuestName(fullName)) return null;
  return data;
}

export async function signedRoomConfirmation(supabase, booking) {
  const status = normalizeRoomStatus(booking?.status);
  if (!["confirmed", "approved", "checked_in", "checked_out"].includes(status)) return "";
  if (!booking.confirmation_pdf_path) return "";
  const { data, error } = await supabase.storage
    .from(confirmationBucket)
    .createSignedUrl(booking.confirmation_pdf_path, signedUrlLifetimeSeconds, { download: false });
  if (error) throw error;
  return data?.signedUrl || "";
}

export async function customerRoomStatus(supabase, bookingNumber, fullName) {
  const booking = await roomBookingForCustomer(supabase, bookingNumber, fullName);
  if (!booking) return null;
  const confirmationUrl = await signedRoomConfirmation(supabase, booking);
  return safeRoomBookingRecord(booking, confirmationUrl);
}

async function signedStorageUrl(supabase, bucket, path, expiresIn = 60 * 60) {
  if (!path) return "";
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn, { download: false });
  if (error) {
    console.error("Room admin signed URL failed", {
      bucket,
      code: error.code || "storage_sign_failed",
      message: error.message || "Could not sign room document.",
    });
    return "";
  }
  return data?.signedUrl || "";
}

export async function adminRoomRows(supabase) {
  const { data, error } = await supabase
    .from("room_bookings")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  return Promise.all((data || []).map(async (booking) => ({
    ...booking,
    payment_screenshot_display_url: await signedStorageUrl(
      supabase,
      paymentBucket,
      booking.payment_screenshot_url,
    ),
    government_id_display_url: await signedStorageUrl(
      supabase,
      guestIdBucket,
      booking.government_id_path,
    ),
    confirmation_pdf_display_url: await signedRoomConfirmation(supabase, booking),
  })));
}

export async function transitionRoomBooking(supabase, booking, action, reason = "") {
  const { data, error } = await supabase.rpc("transition_room_booking_v2", {
    p_booking_id: booking.id,
    p_expected_status: booking.status,
    p_action: cleanRoomText(action).toLowerCase(),
    p_reason: cleanRoomText(reason) || null,
  });
  if (error) {
    if (error.code === "40001" || /changed while/i.test(error.message || "")) {
      throw new PublicError(
        "This booking changed while you were reviewing it. Refresh and try again.",
        409,
        "stale_room_booking",
      );
    }
    if (error.code === "P0001" || /no longer available|capacity/i.test(error.message || "")) {
      throw unavailableError();
    }
    throw error;
  }
  return Array.isArray(data) ? data[0] : data;
}

export async function updateRoomInventoryCapacity(supabase, id, payload) {
  const totalRooms = Number(payload.totalRooms);
  const sellableRooms = Number(payload.sellableRooms);
  if (!Number.isInteger(totalRooms) || totalRooms < 0 || totalRooms > 1000) {
    throw new PublicError("Total rooms must be a whole number between 0 and 1000.");
  }
  if (!Number.isInteger(sellableRooms) || sellableRooms < 0 || sellableRooms > totalRooms) {
    throw new PublicError("Sellable rooms must be between 0 and the total room count.");
  }
  const { data, error } = await supabase
    .from("room_inventory")
    .update({
      total_rooms: totalRooms,
      sellable_rooms: sellableRooms,
      available_rooms: sellableRooms,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cleanRoomText(id))
    .select("id, room_type, total_rooms, sellable_rooms, available_rooms, updated_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new PublicError("Room inventory record was not found.", 404);
  return data;
}
