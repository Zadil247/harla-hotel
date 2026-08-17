import { Buffer } from "node:buffer";
import { requestingAdmin } from "../server/admin-auth.js";
import { ensureEventHallConfirmationPdf } from "../server/event-confirmation-service.js";
import { getSupabaseAdmin } from "../server/supabase-admin.js";

class EventEmailError extends Error {
  constructor(message, status = 400, code = "event_email_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function clean(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizedPhone(value) {
  return clean(value).replace(/\D/g, "");
}

function displayStatus(value, type) {
  const normalized = clean(value).toLowerCase();
  const labels = type === "payment"
    ? {
        not_submitted: "Payment Not Submitted",
        pending: "Payment Pending Verification",
        pending_payment_confirmation: "Payment Pending Verification",
        verified: "Payment Verified",
        paid: "Paid",
        declined: "Payment Declined",
        failed: "Payment Failed",
        cancelled: "Payment Cancelled",
      }
    : {
        pending: "Pending Review",
        confirmed: "Confirmed",
        completed: "Completed",
        cancelled: "Cancelled",
      };
  return labels[normalized] || normalized
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventDocumentTitle(booking) {
  return ["confirmed", "completed"].includes(clean(booking.status).toLowerCase())
    ? "Event Hall Booking Confirmation"
    : "Event Hall Reservation Acknowledgement";
}

function formatDate(value) {
  return value
    ? new Intl.DateTimeFormat("en-ET", { dateStyle: "long" }).format(new Date(`${value}T00:00:00`))
    : "-";
}

function formatTime(value) {
  if (!value) {
    return "-";
  }
  const [hours, minutes] = String(value).split(":").map(Number);
  return new Intl.DateTimeFormat("en-ET", { hour: "numeric", minute: "2-digit" }).format(
    new Date(2000, 0, 1, hours, minutes),
  );
}

async function requestJson(request) {
  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    throw new EventEmailError("This endpoint accepts JSON only.", 415);
  }
  try {
    return await request.json();
  } catch {
    throw new EventEmailError("The email request is not valid JSON.");
  }
}

function emailHtml(booking) {
  const services = Array.isArray(booking.refreshments_services)
    ? booking.refreshments_services
    : [];
  const eventType = booking.event_type === "Other"
    ? booking.custom_event_type || "Other"
    : booking.event_type;
  const serviceList = services.length
    ? `<ul>${services.map((service) => {
        const quantity = Number(service.quantity) > 0
          ? `, ${escapeHtml(service.quantity)} ${escapeHtml(String(service.quantityLabel || "quantity").toLowerCase())}`
          : "";
        return `<li>${escapeHtml(service.name)}${quantity}</li>`;
      }).join("")}</ul>`
    : "<p>No refreshments or additional services were selected.</p>";
  const documentTitle = eventDocumentTitle(booking);

  return `
    <!doctype html>
    <html lang="en">
      <body style="margin:0;background:#f3f1eb;color:#222;font-family:Arial,sans-serif;">
        <div style="max-width:680px;margin:0 auto;padding:28px 16px;">
          <div style="background:#1e1e1d;border-top:5px solid #be9124;padding:28px;color:#fff;">
            <h1 style="margin:0 0 8px;font-size:25px;">Harla Hotel</h1>
            <p style="margin:0;color:#e7c76e;">${escapeHtml(documentTitle)}</p>
          </div>
          <div style="background:#fff;padding:30px;border-bottom:1px solid #d7cfbd;">
            <p>Dear ${escapeHtml(booking.client_full_name)},</p>
            <p>Thank you for choosing Harla Hotel. We have received the event hall reservation shown below.</p>
            <table style="width:100%;border-collapse:collapse;margin:24px 0;">
              <tr><td style="padding:9px;background:#f8f5ed;font-weight:bold;">Booking reference</td><td style="padding:9px;">${escapeHtml(booking.booking_reference)}</td></tr>
              <tr><td style="padding:9px;background:#f8f5ed;font-weight:bold;">Organization</td><td style="padding:9px;">${escapeHtml(booking.organization || "-")}</td></tr>
              <tr><td style="padding:9px;background:#f8f5ed;font-weight:bold;">Hall</td><td style="padding:9px;">${escapeHtml(booking.hall_name)}</td></tr>
              <tr><td style="padding:9px;background:#f8f5ed;font-weight:bold;">Event</td><td style="padding:9px;">${escapeHtml(eventType)}</td></tr>
              <tr><td style="padding:9px;background:#f8f5ed;font-weight:bold;">Date</td><td style="padding:9px;">${escapeHtml(formatDate(booking.event_date))}</td></tr>
              <tr><td style="padding:9px;background:#f8f5ed;font-weight:bold;">Time</td><td style="padding:9px;">${escapeHtml(formatTime(booking.start_time))} to ${escapeHtml(formatTime(booking.end_time))}</td></tr>
              <tr><td style="padding:9px;background:#f8f5ed;font-weight:bold;">Attendees</td><td style="padding:9px;">${escapeHtml(booking.attendees)}</td></tr>
              <tr><td style="padding:9px;background:#f8f5ed;font-weight:bold;">Payment status</td><td style="padding:9px;">${escapeHtml(displayStatus(booking.payment_status, "payment"))}</td></tr>
              <tr><td style="padding:9px;background:#f8f5ed;font-weight:bold;">Reservation status</td><td style="padding:9px;">${escapeHtml(displayStatus(booking.status, "reservation"))}</td></tr>
            </table>
            <h2 style="font-size:17px;color:#7e5b10;">Refreshments and Services</h2>
            ${serviceList}
            ${booking.special_requests ? `<h2 style="font-size:17px;color:#7e5b10;">Additional Requests</h2><p>${escapeHtml(booking.special_requests)}</p>` : ""}
            <p style="margin-top:28px;">Thank you for choosing Harla Hotel. We look forward to hosting your event and providing you with an exceptional experience.</p>
          </div>
          <div style="padding:20px 28px;background:#1e1e1d;color:#eee;font-size:13px;">
            Harla Hotel, Harar, Ethiopia<br />+251 915 321 188 · booking@harlahotel.com
          </div>
        </div>
      </body>
    </html>
  `;
}

async function updateEmailState(supabase, id, values) {
  const { error } = await supabase
    .from("event_hall_bookings")
    .update({ ...values, email_attempted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("Could not update event email status", error);
  }
}

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
    }

    try {
      const body = await requestJson(request);
      const bookingReference = clean(body.bookingReference).toUpperCase();
      const phone = clean(body.phone);
      const resend = Boolean(body.resend);

      if (!/^HARLA-HALL-\d{4}-\d{4,}$/.test(bookingReference)) {
        throw new EventEmailError("A valid event hall booking reference is required.");
      }

      const supabase = getSupabaseAdmin();
      const adminUser = await requestingAdmin(supabase, request);
      if (resend && !adminUser) {
        throw new EventEmailError("Admin access is required to resend confirmation email.", 403);
      }

      const { data: booking, error: bookingError } = await supabase
        .from("event_hall_bookings")
        .select("*")
        .eq("booking_reference", bookingReference)
        .maybeSingle();

      if (bookingError) {
        throw bookingError;
      }
      if (!booking) {
        throw new EventEmailError("Event hall booking was not found.", 404);
      }
      if (!adminUser && (booking.booking_source !== "WEBSITE" || normalizedPhone(booking.phone) !== normalizedPhone(phone))) {
        throw new EventEmailError("Event hall booking was not found.", 404);
      }
      if (!booking.email) {
        await updateEmailState(supabase, booking.id, { email_status: "no_email", email_error: null });
        return Response.json({ sent: false, reason: "no_email" });
      }
      if (booking.email_status === "sent" && !resend) {
        return Response.json({ sent: true, alreadySent: true, messageId: booking.email_message_id });
      }

      const apiKey = clean(process.env.RESEND_API_KEY);
      const from = clean(process.env.HARLA_EMAIL_FROM);
      if (!apiKey || !from) {
        await updateEmailState(supabase, booking.id, {
          email_status: "not_configured",
          email_error: "RESEND_API_KEY or HARLA_EMAIL_FROM is not configured.",
        });
        throw new EventEmailError(
          "The reservation is saved, but confirmation email is not configured yet.",
          503,
          "email_not_configured",
        );
      }

      await updateEmailState(supabase, booking.id, { email_status: "sending", email_error: null });
      const confirmation = await ensureEventHallConfirmationPdf(supabase, booking);
      booking.confirmation_pdf_path = confirmation.pdfPath;
      const attachments = [];
      if (booking.confirmation_pdf_path) {
        const { data: pdf, error: pdfError } = await supabase.storage
          .from("event-confirmations")
          .download(booking.confirmation_pdf_path);
        if (!pdfError && pdf) {
          attachments.push({
            filename: `Harla-Hotel-Hall-Booking-${booking.booking_reference}.pdf`,
            content: Buffer.from(await pdf.arrayBuffer()).toString("base64"),
          });
        }
      }

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [booking.email],
          subject: `${eventDocumentTitle(booking)} - Harla Hotel - ${booking.booking_reference}`,
          html: emailHtml(booking),
          attachments,
        }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = result.message || "The email provider rejected the confirmation email.";
        await updateEmailState(supabase, booking.id, { email_status: "failed", email_error: message });
        throw new EventEmailError(message, 502, "email_provider_error");
      }

      await updateEmailState(supabase, booking.id, {
        email_status: "sent",
        email_sent_at: new Date().toISOString(),
        email_message_id: result.id || null,
        email_error: null,
      });

      return Response.json({ sent: true, messageId: result.id || null });
    } catch (error) {
      if (error instanceof EventEmailError) {
        return Response.json({ error: error.message, code: error.code }, { status: error.status });
      }
      console.error("Harla event confirmation email error", error);
      return Response.json(
        { error: "The reservation is saved, but the confirmation email could not be sent.", code: "event_email_service_error" },
        { status: 500 },
      );
    }
  },
};
