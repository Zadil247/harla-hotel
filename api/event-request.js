import { createEventRequestRecord, eventSlotAvailable, portalResponse } from "../server/event-booking-service.js";
import { sendEventWorkflowEmail } from "../server/event-email-service.js";
import { customerPortalUrl } from "../server/event-workflow.js";
import { getSupabaseAdmin } from "../server/supabase-admin.js";

async function bodyJson(request) {
  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    throw Object.assign(new Error("This endpoint accepts JSON only."), { status: 415 });
  }
  return request.json();
}

function response(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export default {
  async fetch(request) {
    if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);
    try {
      const body = await bodyJson(request);
      const supabase = getSupabaseAdmin();

      if (body.action === "readiness") {
        const [columnsResult, availabilityResult] = await Promise.all([
          supabase
            .from("event_hall_bookings")
            .select("portal_token_hash, quoted_amount, quoted_currency, payment_deadline")
            .limit(0),
          supabase.rpc("event_hall_slot_is_available", {
            p_hall_id: null,
            p_event_date: null,
            p_start_time: null,
            p_end_time: null,
            p_exclude_booking_id: null,
          }),
        ]);
        return response({ ready: !columnsResult.error && !availabilityResult.error });
      }

      if (body.action === "availability") {
        const available = await eventSlotAvailable(supabase, body);
        return response({ available });
      }

      const created = await createEventRequestRecord(supabase, body, {
        source: "WEBSITE",
        status: "pending_review",
      });
      if (!created.portalToken) {
        return response({
          error: "This request already exists. Use the secure link previously emailed to you, or contact Harla Hotel.",
        }, 409);
      }

      let email = { sent: false, reason: "not_attempted" };
      try {
        email = await sendEventWorkflowEmail(
          supabase,
          created.booking,
          "request_received",
          created.portalToken,
        );
      } catch (error) {
        console.error("Event request received email failed", error);
        await supabase.from("event_hall_bookings").update({
          email_status: "failed",
          email_error: error.message || "Request received email failed.",
          email_attempted_at: new Date().toISOString(),
        }).eq("id", created.booking.id);
        email = { sent: false, reason: "email_failed" };
      }

      return response({
        request: await portalResponse(supabase, created.booking),
        portalToken: created.portalToken,
        portalUrl: customerPortalUrl(created.booking.booking_reference, created.portalToken),
        email,
      }, created.existing ? 200 : 201);
    } catch (error) {
      console.error("Event request API error", error);
      const unavailable = /unavailable|already held|already reserved/i.test(error.message || "");
      return response({
        error: unavailable
          ? "This hall is unavailable for the selected date and time. Please choose another time or contact Harla Hotel."
          : error.message || "The Event Hall request could not be saved.",
      }, error.status || (unavailable ? 409 : 400));
    }
  },
};
