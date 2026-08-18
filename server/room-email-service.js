import { Buffer } from "node:buffer";
import { requiredEnv, siteUrl } from "./config.js";
import { ensureRoomConfirmationPdf } from "./room-confirmation-service.js";
import { paymentStatusLabel, roomStatusLabel } from "./room-workflow.js";

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
    ? new Intl.DateTimeFormat("en-ET", {
        dateStyle: "long",
        timeZone: "Africa/Addis_Ababa",
      }).format(new Date(`${value}T12:00:00+03:00`))
    : "-";
}

function formatAmount(booking) {
  const amount = Number(booking.total_price_etb ?? booking.total_price ?? 0);
  return amount > 0 ? `${amount.toLocaleString("en-US")} ETB` : "Recorded by Harla Hotel";
}

function statusUrl(booking) {
  const url = new URL("/booking-status.html", siteUrl());
  url.searchParams.set("booking", booking.booking_number);
  return url.toString();
}

export function renderRoomConfirmationEmail(booking) {
  const lookupUrl = statusUrl(booking);
  return {
    subject: `Harla Hotel Booking Confirmed - ${booking.booking_number}`,
    lookupUrl,
    html: `<!doctype html>
      <html lang="en"><body style="margin:0;background:#f2f0ea;color:#242321;font-family:Arial,sans-serif;">
        <div style="max-width:680px;margin:0 auto;padding:28px 16px;">
          <div style="background:#171716;border-top:5px solid #c89a2b;padding:28px;color:#fff;">
            <h1 style="margin:0 0 7px;font-size:25px;">Harla Hotel Reservations</h1>
            <p style="margin:0;color:#e8ca75;">Room Booking Confirmed</p>
          </div>
          <div style="background:#fff;padding:30px;">
            <p>Dear ${escapeHtml(booking.full_name)},</p>
            <p>Your Harla Hotel room booking is confirmed. Your official stamped confirmation is attached to this email.</p>
            <table style="width:100%;border-collapse:collapse;margin:22px 0;">
              <tr><td style="padding:9px;background:#f7f3e8;font-weight:bold;">Booking reference</td><td style="padding:9px;">${escapeHtml(booking.booking_number)}</td></tr>
              <tr><td style="padding:9px;background:#f7f3e8;font-weight:bold;">Room</td><td style="padding:9px;">${escapeHtml(booking.room_type)}</td></tr>
              <tr><td style="padding:9px;background:#f7f3e8;font-weight:bold;">Check-in</td><td style="padding:9px;">${escapeHtml(formatDate(booking.check_in))}</td></tr>
              <tr><td style="padding:9px;background:#f7f3e8;font-weight:bold;">Check-out</td><td style="padding:9px;">${escapeHtml(formatDate(booking.check_out))}</td></tr>
              <tr><td style="padding:9px;background:#f7f3e8;font-weight:bold;">Guests</td><td style="padding:9px;">${escapeHtml(booking.guests)}</td></tr>
              <tr><td style="padding:9px;background:#f7f3e8;font-weight:bold;">Final amount</td><td style="padding:9px;">${escapeHtml(formatAmount(booking))}</td></tr>
              <tr><td style="padding:9px;background:#f7f3e8;font-weight:bold;">Payment</td><td style="padding:9px;">${escapeHtml(paymentStatusLabel(booking.payment_status))}</td></tr>
              <tr><td style="padding:9px;background:#f7f3e8;font-weight:bold;">Booking status</td><td style="padding:9px;">${escapeHtml(roomStatusLabel(booking.status))}</td></tr>
            </table>
            <p style="margin:26px 0 8px;"><a href="${escapeHtml(lookupUrl)}" style="display:inline-block;background:#c89a2b;color:#171716;padding:13px 20px;text-decoration:none;font-weight:bold;">Check Booking Status</a></p>
            <p style="font-size:13px;color:#5d5a52;">Use your full name and booking reference to open the secure status page.</p>
          </div>
          <div style="padding:19px 28px;background:#171716;color:#eee;font-size:13px;line-height:1.55;">
            Harla Hotel Reservations, Harar, Ethiopia<br />+251 915 321 188 | booking@harlahotel.com
          </div>
        </div>
      </body></html>`,
  };
}

async function updateEmailState(supabase, bookingId, values) {
  const { error } = await supabase
    .from("room_bookings")
    .update({ ...values, email_attempted_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) {
    console.error("Could not update room confirmation email status", {
      bookingId,
      code: error.code || "room_email_state_failed",
      message: error.message || "Room email state update failed.",
    });
  }
}

export async function sendRoomConfirmationEmail(supabase, booking) {
  if (!booking.email) {
    await updateEmailState(supabase, booking.id, { email_status: "no_email", email_error: null });
    return { sent: false, reason: "no_email" };
  }

  const apiKey = requiredEnv("RESEND_API_KEY");
  const from = requiredEnv("HARLA_ROOM_EMAIL_FROM");
  const confirmation = await ensureRoomConfirmationPdf(supabase, booking);
  const { data: pdf, error: pdfError } = await supabase.storage
    .from("room-confirmations")
    .download(confirmation.pdfPath);
  if (pdfError || !pdf) throw pdfError || new Error("The official room confirmation PDF could not be attached.");
  const rendered = renderRoomConfirmationEmail(booking);

  await updateEmailState(supabase, booking.id, {
    email_status: "sending",
    email_error: null,
  });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [booking.email],
      subject: rendered.subject,
      html: rendered.html,
      attachments: [{
        filename: confirmation.fileName,
        content: Buffer.from(await pdf.arrayBuffer()).toString("base64"),
      }],
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result.message || "The email provider rejected the room confirmation email.";
    await updateEmailState(supabase, booking.id, { email_status: "failed", email_error: message });
    throw new Error(message);
  }

  const now = new Date().toISOString();
  await updateEmailState(supabase, booking.id, {
    email_status: "sent",
    email_sent_at: now,
    email_message_id: result.id || null,
    email_error: null,
  });
  return { sent: true, messageId: result.id || null, lookupUrl: rendered.lookupUrl };
}
