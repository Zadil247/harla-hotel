import { getStripe } from "./stripe-client.js";
import { getSupabaseAdmin } from "./supabase-admin.js";

function paymentIntentId(session) {
  if (typeof session.payment_intent === "string") {
    return session.payment_intent;
  }
  return session.payment_intent?.id || null;
}

function isNoRoomError(error) {
  return String(error?.message || "").includes("NO_ROOM_AVAILABLE");
}

async function markPaymentUnavailable(bookingId, session) {
  const stripe = getStripe();
  const supabase = getSupabaseAdmin();
  const intentId = paymentIntentId(session);

  if (intentId) {
    await stripe.refunds.create(
      {
        payment_intent: intentId,
        reason: "requested_by_customer",
        metadata: {
          reason: "room_inventory_unavailable",
          checkout_session_id: session.id,
        },
      },
      {
        idempotencyKey: `harla-room-unavailable-${session.id}`,
      },
    );
  }

  const { error } = await supabase
    .from("room_bookings")
    .update({
      payment_status: "cancelled",
      stripe_payment_intent_id: intentId,
      stripe_payment_status: intentId
        ? "refunded_room_unavailable"
        : "room_unavailable",
    })
    .eq("id", bookingId);

  if (error) {
    throw error;
  }

  return {
    confirmed: false,
    roomUnavailable: true,
    refunded: Boolean(intentId),
  };
}

export async function fulfillCheckoutSession(sessionOrId) {
  const stripe = getStripe();
  const supabase = getSupabaseAdmin();
  const session =
    typeof sessionOrId === "string"
      ? await stripe.checkout.sessions.retrieve(sessionOrId, {
          expand: ["payment_intent"],
        })
      : sessionOrId;

  if (session.payment_status !== "paid") {
    return {
      confirmed: false,
      paymentStatus: session.payment_status,
      roomUnavailable: false,
    };
  }

  const bookingId = session.metadata?.booking_id;
  if (!bookingId) {
    throw new Error(`Stripe session ${session.id} has no booking_id metadata.`);
  }

  const { data: booking, error: bookingError } = await supabase
    .from("room_bookings")
    .select(
      "id,status,payment_status,total_price_usd,stripe_payment_status",
    )
    .eq("id", bookingId)
    .eq("stripe_session_id", session.id)
    .single();

  if (bookingError) {
    throw bookingError;
  }

  if (booking.status === "confirmed" && booking.payment_status === "paid") {
    return {
      confirmed: true,
      paymentStatus: "paid",
      roomUnavailable: false,
    };
  }

  if (booking.stripe_payment_status === "refunded_room_unavailable") {
    return {
      confirmed: false,
      paymentStatus: "cancelled",
      roomUnavailable: true,
      refunded: true,
    };
  }

  const expectedAmount = Math.round(Number(booking.total_price_usd) * 100);
  if (
    session.currency !== "usd" ||
    !Number.isInteger(expectedAmount) ||
    expectedAmount < 1 ||
    session.amount_total !== expectedAmount
  ) {
    throw new Error(`Stripe amount verification failed for session ${session.id}.`);
  }

  const intentId = paymentIntentId(session);
  const { error: confirmationError } = await supabase.rpc(
    "confirm_stripe_room_booking",
    {
      booking_id: booking.id,
      checkout_session_id: session.id,
      payment_intent_id: intentId,
    },
  );

  if (confirmationError) {
    if (isNoRoomError(confirmationError)) {
      return markPaymentUnavailable(booking.id, session);
    }
    throw confirmationError;
  }

  return {
    confirmed: true,
    paymentStatus: "paid",
    roomUnavailable: false,
  };
}

export async function markStripeSessionState(session, state) {
  const bookingId = session.metadata?.booking_id;
  if (!bookingId) {
    return;
  }

  const updates = {
    stripe_payment_status: state,
  };

  if (state === "failed") {
    updates.payment_status = "failed";
    updates.stripe_payment_intent_id = paymentIntentId(session);
  } else if (state === "cancelled") {
    updates.payment_status = "cancelled";
  }

  const { error } = await getSupabaseAdmin()
    .from("room_bookings")
    .update(updates)
    .eq("id", bookingId)
    .neq("status", "confirmed");

  if (error) {
    throw error;
  }
}

export async function markStripePaymentIntentFailed(paymentIntent) {
  const bookingId = paymentIntent.metadata?.booking_id;
  if (!bookingId) {
    return;
  }

  const { error } = await getSupabaseAdmin()
    .from("room_bookings")
    .update({
      payment_status: "failed",
      stripe_payment_intent_id: paymentIntent.id,
      stripe_payment_status: "failed",
    })
    .eq("id", bookingId)
    .neq("status", "confirmed");

  if (error) {
    throw error;
  }
}
