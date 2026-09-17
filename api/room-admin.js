import { masterAdminRequest } from "../server/master-admin-api.js";
import { requestingRoomAdmin } from "../server/admin-auth.js";
import {
  adminRoomRows,
  roomAvailabilityForDates,
  transitionRoomBooking,
  updateRoomInventoryCapacity,
} from "../server/room-booking-service.js";
import { ensureRoomConfirmationPdf } from "../server/room-confirmation-service.js";
import { sendRoomConfirmationEmail } from "../server/room-email-service.js";
import { cleanRoomText } from "../server/room-workflow.js";
import { getSupabaseAdmin } from "../server/supabase-admin.js";

function response(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const staleBookingMessage = "This booking changed while you were reviewing it. Refresh and try again.";

export function roomAdminErrorDetails(error = {}) {
  const stale = error.code === "40001" || error.code === "stale_room_booking";
  return {
    status: error.status || (stale ? 409 : 400),
    message: stale
      ? staleBookingMessage
      : error.message || "The Room Admin action failed.",
  };
}

async function requestJson(request) {
  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    throw Object.assign(new Error("This endpoint accepts JSON only."), { status: 415 });
  }
  return request.json();
}

async function bookingById(supabase, id) {
  const { data, error } = await supabase
    .from("room_bookings")
    .select("*")
    .eq("id", cleanRoomText(id))
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("Room booking was not found."), { status: 404 });
  return data;
}

async function roomAdminProfile(supabase, admin) {
  if (admin.masterAdmin) return { ...admin.masterProfile, role: "master_admin" };
  const { data, error } = await supabase
    .from("room_admin_users")
    .select("user_id, email, full_name, role, active")
    .eq("user_id", admin.id)
    .eq("active", true)
    .single();
  if (error) throw error;
  return data;
}

export default {
  async fetch(request) {
    if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);
    try {
      const body = await requestJson(request);
      if (body.scope === "manager") return await masterAdminRequest(request, body);
      let supabase = getSupabaseAdmin();
      const admin = await requestingRoomAdmin(supabase, request);
      if (!admin) return response({ error: "Active Harla Hotel Room Admin access is required." }, 403);

      supabase = getSupabaseAdmin(admin.id);

      if (body.action === "profile") {
        return response({ profile: await roomAdminProfile(supabase, admin) });
      }

      if (body.action === "dashboard") {
        const availabilityPromise = body.checkIn && body.checkOut
          ? roomAvailabilityForDates(supabase, body.checkIn, body.checkOut)
          : Promise.resolve([]);
        const [bookings, inventoryResult, availability] = await Promise.all([
          adminRoomRows(supabase),
          supabase
            .from("room_inventory")
            .select("id, room_type, total_rooms, sellable_rooms, available_rooms, updated_at")
            .order("room_type", { ascending: true }),
          availabilityPromise,
        ]);
        if (inventoryResult.error) throw inventoryResult.error;
        return response({
          bookings,
          inventory: inventoryResult.data || [],
          availability,
          availabilityRange: body.checkIn && body.checkOut
            ? { checkIn: body.checkIn, checkOut: body.checkOut }
            : null,
        });
      }

      if (body.action === "availability") {
        const availability = await roomAvailabilityForDates(supabase, body.checkIn, body.checkOut);
        return response({ availability, availabilityRange: { checkIn: body.checkIn, checkOut: body.checkOut } });
      }

      if (body.action === "transition") {
        const booking = await bookingById(supabase, body.bookingId);
        let updated = await transitionRoomBooking(
          supabase,
          booking,
          body.transition,
          body.reason,
          admin.id,
        );
        let confirmation = null;
        let email = { sent: false, reason: "not_attempted" };

        if (body.transition === "confirm") {
          try {
            confirmation = await ensureRoomConfirmationPdf(supabase, updated);
            updated = await bookingById(supabase, updated.id);
          } catch (error) {
            console.error("Room confirmation PDF failed after database confirmation", {
              bookingReference: updated.booking_number,
              message: error.message || "Room confirmation PDF failed.",
            });
            confirmation = {
              generated: false,
              error: error.message || "Official confirmation generation failed.",
            };
          }
          if (!confirmation.error) {
            try {
              email = await sendRoomConfirmationEmail(supabase, updated);
            } catch (error) {
              console.error("Room confirmation email failed", {
                bookingReference: updated.booking_number,
                message: error.message || "Room confirmation email failed.",
              });
              email = { sent: false, error: error.message || "Confirmation email failed." };
            }
          }
        }
        return response({ booking: updated, confirmation, email });
      }

      if (body.action === "contacted") {
        const booking = await bookingById(supabase, body.bookingId);
        const { data, error } = await supabase
          .from("room_bookings")
          .update({ customer_contacted: true, contacted_at: new Date().toISOString() })
          .eq("id", booking.id)
          .eq("updated_at", booking.updated_at)
          .select("*")
          .maybeSingle();
        if (error) throw error;
        if (!data) return response({ error: "This booking changed. Refresh and try again." }, 409);
        return response({ booking: data });
      }

      if (body.action === "inventory") {
        const inventory = await updateRoomInventoryCapacity(supabase, body.inventoryId, body.values || {});
        return response({ inventory });
      }

      if (body.action === "confirmation") {
        const booking = await bookingById(supabase, body.bookingId);
        const confirmation = await ensureRoomConfirmationPdf(supabase, booking, {
          force: Boolean(body.regenerate),
        });
        return response({ confirmation });
      }

      if (body.action === "resend_confirmation") {
        let booking = await bookingById(supabase, body.bookingId);
        await ensureRoomConfirmationPdf(supabase, booking);
        booking = await bookingById(supabase, booking.id);
        const email = await sendRoomConfirmationEmail(supabase, booking);
        return response({ email });
      }

      return response({ error: "Choose a valid Room Admin action." }, 400);
    } catch (error) {
      console.error("Room Admin API error", {
        code: error.code || "room_admin_api_error",
        message: error.message || "Room Admin API failed.",
      });
      const details = roomAdminErrorDetails(error);
      return response({ error: details.message }, details.status);
    }
  },
};
