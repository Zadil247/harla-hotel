import { verifyCheckoutCancelToken } from "../server/checkout-token.js";
import { PublicError, publicErrorResponse } from "../server/errors.js";
import { getStripe } from "../server/stripe-client.js";
import {
  fulfillCheckoutSession,
  markStripeSessionState,
} from "../server/stripe-fulfillment.js";
import { getSupabaseAdmin } from "../server/supabase-admin.js";

const safeBookingFields = [
  "booking_number",
  "full_name",
  "room_type",
  "check_in",
  "check_out",
  "nights",
  "guests",
  "total_price_usd",
  "payment_currency",
  "payment_status",
  "status",
].join(",");

async function sessionStatus(request) {
  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId || !/^cs_(test|live)_/.test(sessionId)) {
    throw new PublicError("A valid Stripe Checkout session is required.");
  }

  const session = await getStripe().checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });
  const fulfillment = await fulfillCheckoutSession(session);
  const { data: booking, error } = await getSupabaseAdmin()
    .from("room_bookings")
    .select(safeBookingFields)
    .eq("stripe_session_id", session.id)
    .single();

  if (error) {
    throw error;
  }

  return Response.json(
    {
      checkoutStatus: session.status,
      fulfillment,
      booking,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function cancelSession(request) {
  const body = await request.json();
  const bookingNumber = String(body.bookingNumber || "").trim().toUpperCase();
  if (
    !bookingNumber ||
    !verifyCheckoutCancelToken(bookingNumber, body.token)
  ) {
    throw new PublicError("This checkout cancellation link is invalid.", 403);
  }

  const supabase = getSupabaseAdmin();
  const { data: booking, error } = await supabase
    .from("room_bookings")
    .select(
      "id,booking_number,status,payment_status,stripe_session_id,stripe_payment_status",
    )
    .eq("booking_number", bookingNumber)
    .single();

  if (error) {
    throw error;
  }
  if (booking.status === "confirmed" || booking.payment_status === "paid") {
    throw new PublicError(
      "This booking has already been paid and confirmed.",
      409,
    );
  }

  if (booking.stripe_session_id) {
    const session = await getStripe().checkout.sessions.retrieve(
      booking.stripe_session_id,
    );
    if (session.status === "open") {
      await getStripe().checkout.sessions.expire(session.id);
    }
    await markStripeSessionState(session, "cancelled");
  }

  return Response.json({
    bookingNumber,
    paymentStatus: "cancelled",
    message:
      "Card checkout was cancelled. Your room has not been confirmed or charged.",
  });
}

export default {
  async fetch(request) {
    try {
      if (request.method === "GET") {
        return await sessionStatus(request);
      }
      if (request.method === "POST") {
        return await cancelSession(request);
      }
      return Response.json(
        { error: "Method not allowed." },
        { status: 405, headers: { Allow: "GET, POST" } },
      );
    } catch (error) {
      return publicErrorResponse(error);
    }
  },
};
