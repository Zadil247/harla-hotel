import { requestingEventAdmin } from "../server/admin-auth.js";
import { rotateAndSendEventWorkflowEmail } from "../server/event-email-service.js";
import { cleanText, normalizeEventStatus } from "../server/event-workflow.js";
import { getSupabaseAdmin } from "../server/supabase-admin.js";

function response(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function emailType(status) {
  const value = normalizeEventStatus(status);
  if (["confirmed", "completed"].includes(value)) return "confirmed";
  if (value === "approved_awaiting_payment") return "payment_request";
  if (value === "payment_submitted") return "payment_submitted";
  if (value === "needs_information") return "needs_information";
  if (["rejected", "cancelled"].includes(value)) return "status_update";
  return "request_received";
}

export default {
  async fetch(request) {
    if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);
    try {
      if (!(request.headers.get("content-type") || "").includes("application/json")) {
        return response({ error: "This endpoint accepts JSON only." }, 415);
      }
      const body = await request.json();
      const reference = cleanText(body.bookingReference).toUpperCase();
      const supabase = getSupabaseAdmin();
      const admin = await requestingEventAdmin(supabase, request);
      if (!admin) return response({ error: "Active Harla Hotel Events Team access is required." }, 403);

      const { data: booking, error } = await supabase
        .from("event_hall_bookings")
        .select("*")
        .eq("booking_reference", reference)
        .maybeSingle();
      if (error) throw error;
      if (!booking) return response({ error: "Event Hall request was not found." }, 404);

      const delivered = await rotateAndSendEventWorkflowEmail(supabase, booking, emailType(booking.status));
      return response(delivered.email);
    } catch (error) {
      console.error("Event Hall email endpoint error", error);
      return response({ error: error.message || "The Event Hall email could not be sent." }, 500);
    }
  },
};
