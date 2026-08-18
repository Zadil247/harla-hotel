import { requestingEventAdmin } from "../server/admin-auth.js";
import {
  adminEventRows,
  createEventRequestRecord,
  updateEventByAdmin,
} from "../server/event-booking-service.js";
import { sendStableEventWorkflowEmail } from "../server/event-email-service.js";
import { ensureEventHallConfirmationPdf } from "../server/event-confirmation-service.js";
import { cleanText, normalizeEventStatus } from "../server/event-workflow.js";
import { getSupabaseAdmin } from "../server/supabase-admin.js";

function response(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function requestJson(request) {
  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    throw Object.assign(new Error("This endpoint accepts JSON only."), { status: 415 });
  }
  return request.json();
}

async function bookingById(supabase, id) {
  const { data, error } = await supabase
    .from("event_hall_bookings")
    .select("*")
    .eq("id", cleanText(id))
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("Event Hall request was not found."), { status: 404 });
  return data;
}

function emailTypeForStatus(status) {
  const normalized = normalizeEventStatus(status);
  if (normalized === "confirmed" || normalized === "completed") return "confirmed";
  if (normalized === "approved_awaiting_payment") return "payment_request";
  if (normalized === "payment_submitted") return "payment_submitted";
  if (normalized === "needs_information") return "needs_information";
  if (["rejected", "cancelled"].includes(normalized)) return "status_update";
  return "request_received";
}

export default {
  async fetch(request) {
    if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);
    try {
      const body = await requestJson(request);
      const supabase = getSupabaseAdmin();
      const admin = await requestingEventAdmin(supabase, request);
      if (!admin) return response({ error: "Active Harla Hotel Events Team access is required." }, 403);

      if (body.action === "profile") {
        const { data: profile, error } = await supabase
          .from("event_admin_users")
          .select("user_id, email, full_name, role, active")
          .eq("user_id", admin.id)
          .eq("active", true)
          .single();
        if (error) throw error;
        return response({ profile });
      }

      if (body.action === "dashboard") {
        const [bookings, hallsResult, legacyResult] = await Promise.all([
          adminEventRows(supabase),
          supabase.from("event_halls").select("*").order("name"),
          supabase.from("event_requests").select("*").order("created_at", { ascending: false }),
        ]);
        if (hallsResult.error) throw hallsResult.error;
        if (legacyResult.error) throw legacyResult.error;
        return response({ bookings, halls: hallsResult.data || [], legacyRequests: legacyResult.data || [] });
      }

      if (body.action === "detail") {
        const booking = await bookingById(supabase, body.bookingId);
        const [signed] = await adminEventRows(supabase).then((rows) => rows.filter((item) => item.id === booking.id));
        return response({ booking: signed || booking });
      }

      if (body.action === "create") {
        const approved = body.saveMode === "approve";
        const created = await createEventRequestRecord(supabase, body.request, {
          source: body.source,
          status: approved ? "approved_awaiting_payment" : "pending_review",
          quotedAmount: body.quotedAmount,
          quotedCurrency: body.quotedCurrency,
          paymentInstructions: body.paymentInstructions,
          paymentDeadline: body.paymentDeadline,
          createdBy: admin.id,
        });
        const emailType = approved ? "payment_request" : "request_received";
        let email = { sent: false };
        try {
          const delivered = await sendStableEventWorkflowEmail(supabase, created.booking, emailType);
          email = delivered.email;
        } catch (error) {
          console.error("Admin-created Event Hall email failed", error);
          email = { sent: false, error: error.message };
        }
        return response({ booking: created.booking, email }, 201);
      }

      if (body.action === "transition") {
        const booking = await bookingById(supabase, body.bookingId);
        let updated = await updateEventByAdmin(supabase, booking, body.transition, body.values || {});
        let email = { sent: false };

        if (["approve_quote", "verify_confirm", "needs_information", "request_replacement", "reject", "cancel"].includes(body.transition)) {
          const type = body.transition === "verify_confirm"
            ? "confirmed"
            : body.transition === "approve_quote"
              ? "payment_request"
              : body.transition === "needs_information"
                ? "needs_information"
                : body.transition === "request_replacement"
                  ? "payment_request"
                : "status_update";
          if (type === "confirmed") {
            await ensureEventHallConfirmationPdf(supabase, updated, { force: false });
            updated = await bookingById(supabase, updated.id);
          }
          try {
            const delivered = await sendStableEventWorkflowEmail(supabase, updated, type);
            updated = delivered.booking;
            email = delivered.email;
          } catch (error) {
            console.error("Event Hall transition email failed", error);
            email = { sent: false, error: error.message };
          }
        }
        return response({ booking: updated, email });
      }

      if (body.action === "resend") {
        const booking = await bookingById(supabase, body.bookingId);
        const type = emailTypeForStatus(booking.status);
        const delivered = await sendStableEventWorkflowEmail(supabase, booking, type);
        return response(delivered);
      }

      return response({ error: "Choose a valid Event Hall admin action." }, 400);
    } catch (error) {
      console.error("Event Admin API error", error);
      const unavailable = error.code === "23P01" || /already held|unavailable/i.test(error.message || "");
      return response({ error: error.message || "The Event Hall admin action failed." }, error.status || (unavailable ? 409 : 400));
    }
  },
};
