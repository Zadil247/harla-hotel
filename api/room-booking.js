import {
  createRoomBookingRecord,
  customerRoomStatus,
  roomAvailabilityForDates,
} from "../server/room-booking-service.js";
import { PublicError } from "../server/errors.js";
import { ethiopiaTodayIso } from "../server/room-workflow.js";
import {
  authorizeRoomBookingUploads,
  cancelAuthorizedRoomUploads,
  completeAuthorizedRoomUploads,
} from "../server/room-upload-service.js";
import { getSupabaseAdmin } from "../server/supabase-admin.js";

function response(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

async function requestJson(request) {
  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    throw new PublicError("This endpoint accepts JSON only.", 415);
  }
  try {
    return await request.json();
  } catch {
    throw new PublicError("The room booking request is not valid JSON.");
  }
}

function tomorrow(dateText) {
  const date = new Date(`${dateText}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export default {
  async fetch(request) {
    if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);

    try {
      const body = await requestJson(request);
      const supabase = getSupabaseAdmin();

      if (body.action === "readiness") {
        const today = ethiopiaTodayIso();
        const [columns, availability] = await Promise.all([
          supabase
            .from("room_bookings")
            .select("confirmation_pdf_path, confirmation_pdf_generated_at, confirmation_pdf_sha256, decline_reason")
            .limit(0),
          supabase.rpc("get_room_availability_for_dates", {
            p_check_in: today,
            p_check_out: tomorrow(today),
          }),
        ]);
        return response({ ready: !columns.error && !availability.error });
      }

      if (body.action === "availability") {
        const rooms = await roomAvailabilityForDates(supabase, body.checkIn, body.checkOut);
        return response({ rooms });
      }

      if (body.action === "status") {
        const booking = await customerRoomStatus(supabase, body.bookingNumber, body.fullName);
        if (!booking) {
          return response({ error: "No booking matched those details." }, 404);
        }
        return response({ booking });
      }

      if (body.action === "authorize_uploads") {
        const authorization = await authorizeRoomBookingUploads(
          supabase,
          body.booking || {},
          body.files || {},
        );
        return response(authorization, 201);
      }

      if (body.action === "cancel_uploads") {
        await cancelAuthorizedRoomUploads(supabase, body.uploadAuthorizationToken);
        return response({ cancelled: true });
      }

      if (body.action === "create") {
        const trustedBooking = await completeAuthorizedRoomUploads(
          supabase,
          body.booking || body,
          body.uploadAuthorizationToken,
        );
        const created = await createRoomBookingRecord(supabase, trustedBooking);
        return response({ booking: created }, 201);
      }

      return response({ error: "Choose a valid room booking action." }, 400);
    } catch (error) {
      if (error instanceof PublicError) {
        return response({ error: error.message, code: error.code }, error.status);
      }
      console.error("Room Booking API error", {
        code: error.code || "room_booking_api_error",
        message: error.message || "Room Booking API failed.",
      });
      const unavailable = error.code === "P0001" || /no longer available|unavailable/i.test(error.message || "");
      return response(
        {
          error: unavailable
            ? "This room is no longer available for the selected dates. Please choose another room or contact Harla Hotel."
            : "The secure room booking service could not complete this request. Please try again or contact Harla Hotel.",
          code: unavailable ? "room_unavailable" : "room_booking_service_error",
        },
        unavailable ? 409 : 500,
      );
    }
  },
};
