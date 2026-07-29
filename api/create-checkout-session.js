import { validateInternationalBooking } from "../server/booking-validation.js";
import { createCheckoutCancelToken } from "../server/checkout-token.js";
import { getEtbToUsdQuote } from "../server/exchange-rate.js";
import { PublicError, publicErrorResponse } from "../server/errors.js";
import { siteUrl } from "../server/config.js";
import { getStripe } from "../server/stripe-client.js";
import { getSupabaseAdmin } from "../server/supabase-admin.js";

async function requestJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new PublicError("This endpoint accepts JSON only.", 415);
  }

  try {
    return await request.json();
  } catch {
    throw new PublicError("The checkout request is not valid JSON.");
  }
}

function cents(amount) {
  return Math.round(Number(amount) * 100);
}

async function availableRoom(roomName) {
  const { data, error } = await getSupabaseAdmin()
    .from("room_inventory")
    .select("room_type,available_rooms")
    .eq("room_type", roomName)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data || Number(data.available_rooms) < 1) {
    throw new PublicError(
      `${roomName} is no longer available. Please choose another room or contact Harla Hotel.`,
      409,
      "room_unavailable",
    );
  }
}

function matchesExistingBooking(existing, booking) {
  return (
    existing.email?.toLowerCase() === booking.email &&
    existing.phone === booking.phone &&
    existing.room_type === booking.room.name
  );
}

async function reusableSession(existing) {
  if (!existing?.stripe_session_id) {
    return null;
  }

  const session = await getStripe().checkout.sessions.retrieve(
    existing.stripe_session_id,
  );
  return session.status === "open" && session.url ? session : null;
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
      const booking = validateInternationalBooking(await requestJson(request));
      const supabase = getSupabaseAdmin();
      const stripe = getStripe();
      const origin = siteUrl();
      const totalEtb = booking.room.pricePerNightEtb * booking.nights;

      await availableRoom(booking.room.name);

      const { data: existing, error: existingError } = await supabase
        .from("room_bookings")
        .select(
          "id,booking_number,email,phone,room_type,status,payment_status,stripe_session_id,total_price_etb,total_price_usd,exchange_rate,exchange_rate_date",
        )
        .eq("booking_number", booking.bookingNumber)
        .maybeSingle();

      if (existingError) {
        throw existingError;
      }
      if (existing && !matchesExistingBooking(existing, booking)) {
        throw new PublicError(
          "This booking reference is already in use. Please restart checkout.",
          409,
          "booking_reference_conflict",
        );
      }
      if (existing?.status === "confirmed" || existing?.payment_status === "paid") {
        throw new PublicError(
          "This booking is already confirmed.",
          409,
          "booking_already_confirmed",
        );
      }

      const reusable = await reusableSession(existing);
      if (reusable) {
        return Response.json({
          bookingNumber: booking.bookingNumber,
          checkoutUrl: reusable.url,
          sessionId: reusable.id,
          quote: {
            totalEtb: Number(existing.total_price_etb),
            totalUsd: Number(existing.total_price_usd),
            etbPerUsd: Number(existing.exchange_rate),
            exchangeRateDate: existing.exchange_rate_date,
            provider: "Saved checkout quote",
          },
        });
      }

      const quote = await getEtbToUsdQuote(totalEtb);
      const bookingValues = {
        booking_number: booking.bookingNumber,
        full_name: booking.fullName,
        phone: booking.phone,
        email: booking.email,
        date_of_birth: booking.dateOfBirth,
        nationality: booking.nationality,
        room_type: booking.room.name,
        room_slug: booking.room.slug,
        room_name: booking.room.name,
        check_in: booking.checkIn,
        check_out: booking.checkOut,
        nights: booking.nights,
        guests: booking.guests,
        number_of_rooms: 1,
        price_per_night: booking.room.pricePerNightEtb,
        total_price: totalEtb,
        total_price_etb: quote.totalEtb,
        total_price_usd: quote.totalUsd,
        exchange_rate: quote.etbPerUsd,
        exchange_rate_date: quote.exchangeRateDate,
        payment_currency: "USD",
        payment_method: "Stripe",
        payment_reference: null,
        payment_screenshot_url: null,
        payment_status: "pending_payment_confirmation",
        stripe_payment_status: "checkout_creating",
        status: "pending",
        message: booking.message,
        government_id_path: booking.governmentIdPath,
        government_id_file_name: booking.governmentIdFileName,
        government_id_mime_type: booking.governmentIdMimeType,
        government_id_file_size: booking.governmentIdFileSize,
        government_id_uploaded_at: booking.governmentIdUploadedAt,
      };

      let bookingRecord = existing;
      if (existing) {
        const { data, error } = await supabase
          .from("room_bookings")
          .update(bookingValues)
          .eq("id", existing.id)
          .eq("status", "pending")
          .select("id,booking_number")
          .single();
        if (error) {
          throw error;
        }
        bookingRecord = data;
      } else {
        const { data, error } = await supabase
          .from("room_bookings")
          .insert(bookingValues)
          .select("id,booking_number")
          .single();
        if (error) {
          throw error;
        }
        bookingRecord = data;
      }

      let session;
      try {
        const cancelToken = createCheckoutCancelToken(booking.bookingNumber);
        session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            payment_method_types: ["card"],
            customer_email: booking.email,
            client_reference_id: bookingRecord.id,
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: "usd",
                  unit_amount: cents(quote.totalUsd),
                  product_data: {
                    name: `${booking.room.name} · ${booking.nights} night${booking.nights === 1 ? "" : "s"}`,
                    description: `${booking.checkIn} to ${booking.checkOut} · Harla Hotel`,
                  },
                },
              },
            ],
            metadata: {
              booking_id: bookingRecord.id,
              booking_number: booking.bookingNumber,
              room_type: booking.room.name,
            },
            payment_intent_data: {
              metadata: {
                booking_id: bookingRecord.id,
                booking_number: booking.bookingNumber,
              },
            },
            success_url: `${origin}/stripe-success.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${origin}/stripe-cancel.html?booking=${encodeURIComponent(booking.bookingNumber)}&token=${cancelToken}`,
            expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
          },
          {
            idempotencyKey: existing?.stripe_session_id
              ? `harla-checkout-${booking.bookingNumber}-after-${existing.stripe_session_id}`
              : `harla-checkout-${booking.bookingNumber}`,
          },
        );
      } catch (error) {
        await supabase
          .from("room_bookings")
          .update({
            payment_status: "failed",
            stripe_payment_status: "checkout_creation_failed",
          })
          .eq("id", bookingRecord.id);
        throw error;
      }

      const { error: sessionUpdateError } = await supabase
        .from("room_bookings")
        .update({
          stripe_session_id: session.id,
          stripe_payment_status: session.status || "open",
        })
        .eq("id", bookingRecord.id);

      if (sessionUpdateError) {
        await stripe.checkout.sessions.expire(session.id);
        throw sessionUpdateError;
      }

      return Response.json(
        {
          bookingNumber: booking.bookingNumber,
          checkoutUrl: session.url,
          sessionId: session.id,
          quote,
        },
        { status: 201 },
      );
    } catch (error) {
      return publicErrorResponse(error);
    }
  },
};
