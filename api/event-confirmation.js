import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { requestingAdmin } from "../server/admin-auth.js";
import { ensureEventHallConfirmationPdf } from "../server/event-confirmation-service.js";
import { getSupabaseAdmin } from "../server/supabase-admin.js";

class EventConfirmationError extends Error {
  constructor(message, status = 400, code = "event_confirmation_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function clean(value) {
  return String(value || "").trim();
}

function sameSecret(left, right) {
  const leftBuffer = Buffer.from(clean(left));
  const rightBuffer = Buffer.from(clean(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function requestJson(request) {
  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    throw new EventConfirmationError("This endpoint accepts JSON only.", 415);
  }
  try {
    return await request.json();
  } catch {
    throw new EventConfirmationError("The confirmation request is not valid JSON.");
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

    try {
      const body = await requestJson(request);
      const bookingReference = clean(body.bookingReference).toUpperCase();
      const submissionToken = clean(body.submissionToken);

      if (!/^HARLA-HALL-\d{4}-\d{4,}$/.test(bookingReference)) {
        throw new EventConfirmationError("A valid event hall booking reference is required.");
      }

      const supabase = getSupabaseAdmin();
      const adminUser = await requestingAdmin(supabase, request);
      const { data: booking, error } = await supabase
        .from("event_hall_bookings")
        .select("*")
        .eq("booking_reference", bookingReference)
        .maybeSingle();

      if (error) {
        throw error;
      }
      if (!booking) {
        throw new EventConfirmationError("Event hall booking was not found.", 404);
      }

      const publicOwner = booking.booking_source === "WEBSITE"
        && /^[0-9a-f-]{36}$/i.test(submissionToken)
        && sameSecret(booking.submission_token, submissionToken);
      if (!adminUser && !publicOwner) {
        throw new EventConfirmationError("Event hall booking was not found.", 404);
      }
      if (body.regenerate && !adminUser) {
        throw new EventConfirmationError("Admin access is required to regenerate an official confirmation.", 403);
      }

      const confirmation = await ensureEventHallConfirmationPdf(supabase, booking, {
        force: Boolean(body.regenerate && adminUser),
      });

      return Response.json(
        {
          bookingReference,
          fileName: confirmation.fileName,
          signedUrl: confirmation.signedUrl,
          generated: confirmation.generated,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      if (error instanceof EventConfirmationError) {
        return Response.json(
          { error: error.message, code: error.code },
          { status: error.status },
        );
      }
      console.error("Harla event confirmation generation error", error);
      return Response.json(
        {
          error: "The reservation is saved, but the official confirmation could not be generated. Please contact Harla Hotel.",
          code: "event_confirmation_service_error",
        },
        { status: 500 },
      );
    }
  },
};
