import { requestingEventAdmin } from "../server/admin-auth.js";
import { bookingForPortal, signedEventConfirmation } from "../server/event-booking-service.js";
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
      const portalToken = clean(body.portalToken);

      if (!/^HARLA-HALL-\d{4}-\d{4,}$/.test(bookingReference)) {
        throw new EventConfirmationError("A valid event hall booking reference is required.");
      }

      const supabase = getSupabaseAdmin();
      const adminUser = await requestingEventAdmin(supabase, request);
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

      const publicOwner = adminUser ? null : await bookingForPortal(supabase, bookingReference, portalToken);
      if (!adminUser && !publicOwner) {
        throw new EventConfirmationError("Event hall booking was not found.", 404);
      }
      if (body.regenerate && !adminUser) {
        throw new EventConfirmationError("Admin access is required to regenerate an official confirmation.", 403);
      }

      if (!["confirmed", "completed"].includes(String(booking.status || "").toLowerCase())) {
        throw new EventConfirmationError("The official confirmation is available after the reservation is confirmed.", 409);
      }

      let confirmation;
      if (adminUser) {
        confirmation = await ensureEventHallConfirmationPdf(supabase, booking, {
          force: Boolean(body.regenerate),
        });
      } else {
        const signedUrl = await signedEventConfirmation(supabase, booking);
        if (!signedUrl) {
          throw new EventConfirmationError("The official confirmation is being prepared. Please try again shortly.", 409);
        }
        confirmation = {
          generated: false,
          fileName: `Harla-Hotel-Hall-Booking-${booking.booking_reference}.pdf`,
          pdfPath: booking.confirmation_pdf_path,
          signedUrl,
        };
      }

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
