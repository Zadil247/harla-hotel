import { bookingForPortal, portalResponse, uploadPortalPayment } from "../server/event-booking-service.js";
import { sendEventWorkflowEmail } from "../server/event-email-service.js";
import { cleanText } from "../server/event-workflow.js";
import { getSupabaseAdmin } from "../server/supabase-admin.js";

function response(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function credentials(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    return {
      action: cleanText(form.get("action")),
      reference: cleanText(form.get("reference")),
      token: cleanText(form.get("token")),
      paymentReference: cleanText(form.get("paymentReference")),
      paymentProof: form.get("paymentProof"),
    };
  }
  if (!contentType.includes("application/json")) {
    throw Object.assign(new Error("This endpoint accepts JSON or form data only."), { status: 415 });
  }
  return request.json();
}

export default {
  async fetch(request) {
    if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);
    try {
      const body = await credentials(request);
      const supabase = getSupabaseAdmin();
      const booking = await bookingForPortal(supabase, body.reference, body.token);
      if (!booking) {
        return response({ error: "Event request not found or the secure access link is invalid." }, 404);
      }

      if (body.action === "lookup") {
        return response({ request: await portalResponse(supabase, booking) });
      }
      if (body.action === "upload_payment") {
        const updated = await uploadPortalPayment(
          supabase,
          booking,
          body.token,
          body.paymentProof,
          body.paymentReference,
        );
        let emailSent = false;
        try {
          const email = await sendEventWorkflowEmail(supabase, updated, "payment_submitted", body.token);
          emailSent = email.sent;
        } catch (error) {
          console.error("Event payment acknowledgement email failed", error);
        }
        return response({ request: await portalResponse(supabase, updated), emailSent });
      }
      return response({ error: "Choose a valid customer portal action." }, 400);
    } catch (error) {
      console.error("Event customer portal error", error);
      return response({ error: error.message || "The Event Hall request could not be opened." }, error.status || 400);
    }
  },
};
