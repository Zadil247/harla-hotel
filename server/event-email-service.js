import { Buffer } from "node:buffer";
import { requiredEnv } from "./config.js";
import { syncStableBookingPortalToken } from "./event-booking-service.js";
import { ensureEventHallConfirmationPdf } from "./event-confirmation-service.js";
import { customerPortalUrl, eventStatusLabel } from "./event-workflow.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  return value
    ? new Intl.DateTimeFormat("en-ET", { dateStyle: "long", timeZone: "Africa/Addis_Ababa" })
      .format(new Date(`${value}T12:00:00+03:00`))
    : "-";
}

function formatTime(value) {
  if (!value) return "-";
  const [hour, minute] = String(value).split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatTimeRange(startTime, endTime) {
  const start = String(startTime || "");
  const end = String(endTime || "");
  const nextDay = end && start && end < start ? " (next day)" : "";
  return `${formatTime(startTime)} to ${formatTime(endTime)}${nextDay}`;
}

function money(booking) {
  if (!booking.quoted_amount) return "To be confirmed";
  return `${Number(booking.quoted_amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${booking.quoted_currency || "ETB"}`;
}

function frame(booking, title, lead, portalUrl, body) {
  return `<!doctype html>
    <html lang="en"><body style="margin:0;background:#f2f0ea;color:#242321;font-family:Arial,sans-serif;">
      <div style="max-width:680px;margin:0 auto;padding:28px 16px;">
        <div style="background:#171716;border-top:5px solid #c89a2b;padding:28px;color:#fff;">
          <h1 style="margin:0 0 7px;font-size:25px;">Harla Hotel Events</h1>
          <p style="margin:0;color:#e8ca75;">${escapeHtml(title)}</p>
        </div>
        <div style="background:#fff;padding:30px;">
          <p>Dear ${escapeHtml(booking.client_full_name)},</p>
          <p>${escapeHtml(lead)}</p>
          <table style="width:100%;border-collapse:collapse;margin:22px 0;">
            <tr><td style="padding:9px;background:#f7f3e8;font-weight:bold;">Reference</td><td style="padding:9px;">${escapeHtml(booking.booking_reference)}</td></tr>
            <tr><td style="padding:9px;background:#f7f3e8;font-weight:bold;">Hall</td><td style="padding:9px;">${escapeHtml(booking.hall_name)}</td></tr>
            <tr><td style="padding:9px;background:#f7f3e8;font-weight:bold;">Date</td><td style="padding:9px;">${escapeHtml(formatDate(booking.event_date))}</td></tr>
            <tr><td style="padding:9px;background:#f7f3e8;font-weight:bold;">Time</td><td style="padding:9px;">${escapeHtml(formatTimeRange(booking.start_time, booking.end_time))}</td></tr>
            <tr><td style="padding:9px;background:#f7f3e8;font-weight:bold;">Status</td><td style="padding:9px;">${escapeHtml(eventStatusLabel(booking.status))}</td></tr>
          </table>
          ${body}
          <p style="margin:26px 0 8px;"><a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:#c89a2b;color:#171716;padding:13px 20px;text-decoration:none;font-weight:bold;">View Event Request</a></p>
          <p style="font-size:13px;color:#5d5a52;">This secure link is intended for you. Do not forward it to anyone who should not access the request.</p>
        </div>
        <div style="padding:19px 28px;background:#171716;color:#eee;font-size:13px;line-height:1.55;">
          Harla Hotel Events, Harar, Ethiopia<br />+251 915 321 188 | events@harlahotel.com
        </div>
      </div>
    </body></html>`;
}

export function renderEventEmail(booking, type, portalToken) {
  const portalUrl = customerPortalUrl(booking.booking_reference, portalToken);
  if (type === "request_received") {
    return {
      subject: `Harla Hotel Event Request Received - ${booking.booking_reference}`,
      html: frame(
        booking,
        "Event Request Received",
        "Your event request has been received and is pending review. No payment is required yet. Our Events Team will contact you shortly.",
        portalUrl,
        "<p>Use the secure link below whenever you want to review the latest status of your request.</p>",
      ),
      portalUrl,
    };
  }
  if (type === "payment_request") {
    const deadline = booking.payment_deadline
      ? new Intl.DateTimeFormat("en-ET", { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Addis_Ababa" }).format(new Date(booking.payment_deadline))
      : "Please follow the deadline provided by the Events Team.";
    return {
      subject: `Harla Hotel Event Payment Request - ${booking.booking_reference}`,
      html: frame(
        booking,
        "Event Payment Request",
        "Your event request has been approved for payment. The selected hall and time are now being held while payment is completed.",
        portalUrl,
        `<h2 style="font-size:17px;color:#7b5910;">Payment Details</h2>
         <p><strong>Quoted amount:</strong> ${escapeHtml(money(booking))}</p>
         <p><strong>Payment deadline:</strong> ${escapeHtml(deadline)}</p>
         ${booking.payment_rejection_reason ? `<div style="white-space:pre-line;background:#fff4db;border-left:4px solid #c89a2b;padding:16px;margin-bottom:16px;"><strong>Payment confirmation update:</strong><br />${escapeHtml(booking.payment_rejection_reason)}</div>` : ""}
         <div style="white-space:pre-line;background:#f7f3e8;padding:16px;">${escapeHtml(booking.payment_instructions || "Contact Harla Hotel for payment instructions.")}</div>`,
      ),
      portalUrl,
    };
  }
  if (type === "needs_information") {
    return {
      subject: `Harla Hotel Event Request Needs Information - ${booking.booking_reference}`,
      html: frame(
        booking,
        "Additional Information Required",
        "The Events Team needs a little more information before continuing the review.",
        portalUrl,
        `<div style="white-space:pre-line;background:#f7f3e8;padding:16px;">${escapeHtml(booking.needs_information_message || "Please contact the Harla Hotel Events Team.")}</div>`,
      ),
      portalUrl,
    };
  }
  if (type === "payment_submitted") {
    return {
      subject: `Harla Hotel Event Payment Received - ${booking.booking_reference}`,
      html: frame(
        booking,
        "Payment Confirmation Received",
        "We received your payment confirmation. The Events Team will verify it before confirming the reservation.",
        portalUrl,
        `<p><strong>Quoted amount:</strong> ${escapeHtml(money(booking))}</p>`,
      ),
      portalUrl,
    };
  }
  if (type === "confirmed") {
    return {
      subject: `Harla Hotel Event Hall Booking Confirmed - ${booking.booking_reference}`,
      html: frame(
        booking,
        "Event Hall Booking Confirmed",
        "Your Event Hall reservation is confirmed. Your official stamped confirmation is attached and remains available from the secure customer portal.",
        portalUrl,
        `<p><strong>Confirmed amount:</strong> ${escapeHtml(money(booking))}</p>`,
      ),
      portalUrl,
    };
  }
  if (type === "status_update") {
    return {
      subject: `Harla Hotel Event Request Update - ${booking.booking_reference}`,
      html: frame(
        booking,
        "Event Request Update",
        `Your Event Hall request status is now: ${eventStatusLabel(booking.status)}.`,
        portalUrl,
        booking.decline_reason
          ? `<div style="white-space:pre-line;background:#f7f3e8;padding:16px;">${escapeHtml(booking.decline_reason)}</div>`
          : "<p>Use the secure link below to review the latest information.</p>",
      ),
      portalUrl,
    };
  }
  throw new Error("Choose a valid Event Hall email type.");
}

async function updateEmailState(supabase, bookingId, values) {
  const { error } = await supabase
    .from("event_hall_bookings")
    .update({ ...values, email_attempted_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) {
    console.error("Could not update Event Hall email status", error);
  }
}

export async function sendEventWorkflowEmail(supabase, booking, type, portalToken) {
  if (!booking.email) {
    await updateEmailState(supabase, booking.id, { email_status: "no_email", email_error: null });
    return { sent: false, reason: "no_email" };
  }

  const apiKey = requiredEnv("RESEND_API_KEY");
  const from = requiredEnv("HARLA_EMAIL_FROM");
  const rendered = renderEventEmail(booking, type, portalToken);
  const attachments = [];

  await updateEmailState(supabase, booking.id, {
    email_status: "sending",
    email_error: null,
    last_email_type: type,
  });

  if (type === "confirmed") {
    const confirmation = await ensureEventHallConfirmationPdf(supabase, booking);
    const { data: pdf, error: pdfError } = await supabase.storage
      .from("event-confirmations")
      .download(confirmation.pdfPath);
    if (pdfError || !pdf) {
      throw pdfError || new Error("The official confirmation PDF could not be attached.");
    }
    attachments.push({
      filename: `Harla-Hotel-Hall-Booking-${booking.booking_reference}.pdf`,
      content: Buffer.from(await pdf.arrayBuffer()).toString("base64"),
    });
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [booking.email],
      subject: rendered.subject,
      html: rendered.html,
      attachments,
    }),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = result.message || "The email provider rejected the Event Hall email.";
    await updateEmailState(supabase, booking.id, { email_status: "failed", email_error: message });
    throw new Error(message);
  }

  const now = new Date().toISOString();
  await updateEmailState(supabase, booking.id, {
    email_status: "sent",
    email_sent_at: now,
    email_message_id: result.id || null,
    email_error: null,
    last_email_type: type,
    ...(type === "payment_request" ? { quote_sent_at: now } : {}),
  });
  return { sent: true, messageId: result.id || null, portalUrl: rendered.portalUrl };
}

export async function sendStableEventWorkflowEmail(supabase, booking, type) {
  // Validate delivery configuration before repairing a legacy rotated token hash.
  requiredEnv("RESEND_API_KEY");
  requiredEnv("HARLA_EMAIL_FROM");
  const stable = await syncStableBookingPortalToken(supabase, booking);
  const email = await sendEventWorkflowEmail(supabase, stable.booking, type, stable.portalToken);
  return { booking: stable.booking, email };
}
