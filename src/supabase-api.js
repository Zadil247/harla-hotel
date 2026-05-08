import { getSupabaseClient, hasSupabaseClient } from "./supabase-client.js?v=20260507-supabase";
import { supabaseSetupMessage } from "./supabase-config.js?v=20260507-supabase";

const requestTables = new Set([
  "room_bookings",
  "event_requests",
  "restaurant_requests",
  "package_bookings",
]);

const validStatuses = new Set(["pending", "approved", "rejected"]);

export function isBackendReady() {
  return hasSupabaseClient();
}

export function backendSetupMessage() {
  return supabaseSetupMessage();
}

function clean(value) {
  return String(value || "").trim();
}

function optionalText(value) {
  const text = clean(value);
  return text || null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function requireText(value, label) {
  const text = clean(value);
  if (!text) {
    throw new Error(`${label} is required.`);
  }
  return text;
}

function requirePositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be greater than 0.`);
  }
  return number;
}

function ensureCheckoutAfterCheckin(checkIn, checkOut) {
  if (!checkIn || !checkOut) {
    throw new Error("Check-in and check-out dates are required.");
  }

  if (new Date(`${checkOut}T00:00:00`) <= new Date(`${checkIn}T00:00:00`)) {
    throw new Error("Check-out date must be after check-in date.");
  }
}

async function insertPending(table, payload) {
  const supabase = await getSupabaseClient();
  const { error } = await supabase.from(table).insert({ ...payload, status: "pending" });

  if (error) {
    throw error;
  }

  return { ok: true };
}

export async function createRoomBooking(payload) {
  const checkIn = requireText(payload.checkIn, "Check-in date");
  const checkOut = requireText(payload.checkOut, "Check-out date");
  ensureCheckoutAfterCheckin(checkIn, checkOut);

  return insertPending("room_bookings", {
    room_slug: requireText(payload.roomSlug || payload.roomType, "Room type"),
    room_name: requireText(payload.roomName, "Room name"),
    full_name: requireText(payload.fullName, "Full name"),
    phone: requireText(payload.phone, "Phone number"),
    email: optionalText(payload.email),
    check_in: checkIn,
    check_out: checkOut,
    nights: requirePositiveNumber(payload.nights, "Nights"),
    guests: requirePositiveNumber(payload.guests, "Number of guests"),
    number_of_rooms: requirePositiveNumber(payload.numberOfRooms, "Number of rooms"),
    price_per_night: requirePositiveNumber(payload.pricePerNight, "Room price"),
    total_price: requirePositiveNumber(payload.estimatedTotal || payload.totalPrice, "Estimated total"),
    message: optionalText(payload.message),
  });
}

export async function createRestaurantRequest(payload) {
  return insertPending("restaurant_requests", {
    service_type: requireText(payload.serviceType || "Restaurant reservation", "Reservation type"),
    full_name: requireText(payload.fullName, "Full name"),
    phone: requireText(payload.phone, "Phone number"),
    email: optionalText(payload.email),
    reservation_date: optionalText(payload.reservationDate),
    reservation_time: optionalText(payload.reservationTime),
    guests: numberOrNull(payload.guests),
    message: optionalText(payload.message),
  });
}

export async function createEventRequest(payload) {
  return insertPending("event_requests", {
    service_type: requireText(payload.serviceType || "Event hall booking", "Booking type"),
    event_type: optionalText(payload.eventType),
    full_name: requireText(payload.fullName, "Full name"),
    phone: requireText(payload.phone, "Phone number"),
    email: optionalText(payload.email),
    event_date: optionalText(payload.eventDate),
    start_time: optionalText(payload.startTime),
    end_time: optionalText(payload.endTime),
    guests: numberOrNull(payload.guests),
    catering_package: optionalText(payload.cateringPackage),
    message: optionalText(payload.message),
  });
}

export async function createPackageBooking(payload) {
  return insertPending("package_bookings", {
    service_type: requireText(payload.serviceType || "Hotel + tour package", "Package request type"),
    package_name: optionalText(payload.packageName),
    full_name: requireText(payload.fullName, "Full name"),
    phone: requireText(payload.phone, "Phone number"),
    email: optionalText(payload.email),
    check_in: optionalText(payload.checkIn),
    check_out: optionalText(payload.checkOut),
    guests: numberOrNull(payload.guests),
    message: optionalText(payload.message),
  });
}

export async function signInAdmin(email, password) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: requireText(email, "Email"),
    password: requireText(password, "Password"),
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function signOutAdmin() {
  const supabase = await getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

export async function getAdminSession() {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
}

export async function getCurrentAdminProfile() {
  const supabase = await getSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!userData.user) {
    return null;
  }

  const { data, error } = await supabase
    .from("admin_users")
    .select("id, user_id, email, full_name, role, active")
    .eq("user_id", userData.user.id)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function requireAdminAccess() {
  const session = await getAdminSession();

  if (!session) {
    throw new Error("Please sign in to access the Harla Hotel admin dashboard.");
  }

  const profile = await getCurrentAdminProfile();

  if (!profile) {
    throw new Error("This account is not an active Harla Hotel admin.");
  }

  return profile;
}

export async function getAdminDashboardData() {
  const supabase = await getSupabaseClient();
  const queries = {
    roomBookings: supabase.from("room_bookings").select("*").order("created_at", { ascending: false }),
    eventRequests: supabase.from("event_requests").select("*").order("created_at", { ascending: false }),
    restaurantRequests: supabase.from("restaurant_requests").select("*").order("created_at", { ascending: false }),
    packageBookings: supabase.from("package_bookings").select("*").order("created_at", { ascending: false }),
  };

  const entries = await Promise.all(
    Object.entries(queries).map(async ([key, query]) => {
      const { data, error } = await query;
      if (error) {
        throw error;
      }
      return [key, data || []];
    }),
  );

  return Object.fromEntries(entries);
}

export async function updateRequestStatus(table, id, status) {
  if (!requestTables.has(table)) {
    throw new Error("This request type cannot be updated.");
  }
  if (!validStatuses.has(status)) {
    throw new Error("Choose a valid status.");
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from(table)
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}
