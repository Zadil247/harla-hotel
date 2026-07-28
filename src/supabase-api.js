import { getSupabaseClient, hasSupabaseClient } from "./supabase-client.js?v=20260521-room-automation";
import { supabaseSetupMessage } from "./supabase-config.js?v=20260521-room-automation";

const requestTables = new Set([
  "room_bookings",
  "event_requests",
  "restaurant_requests",
  "restaurant_orders",
  "package_bookings",
]);

const validStatuses = new Set(["pending", "approved", "rejected", "declined", "confirmed"]);
const defaultRestaurantSettings = {
  ordering_available: true,
  custom_message: "",
};
const fallbackRoomInventory = [
  { room_type: "Queen Size Bed Room", total_rooms: 8, available_rooms: 8 },
  { room_type: "Twin Bed Room", total_rooms: 2, available_rooms: 2 },
  { room_type: "VIP Room", total_rooms: 1, available_rooms: 1 },
];

function dashboardFallbackValue(key) {
  if (key === "roomInventory") {
    return fallbackRoomInventory;
  }
  return key === "restaurantSettings" ? { id: "default", ...defaultRestaurantSettings } : [];
}

async function withSignedPaymentScreenshots(supabase, rows = []) {
  return Promise.all(
    rows.map(async (row) => {
      if (!row.payment_screenshot_url) {
        return row;
      }

      if (/^https?:\/\//.test(row.payment_screenshot_url)) {
        return {
          ...row,
          payment_screenshot_display_url: row.payment_screenshot_url,
        };
      }

      const { data } = await supabase.storage
        .from("payment-screenshots")
        .createSignedUrl(row.payment_screenshot_url, 60 * 60);

      return {
        ...row,
        payment_screenshot_display_url: data?.signedUrl || "",
      };
    }),
  );
}

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

function generateOrderNumber() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `HRL-${timestamp}${random}`;
}

function generateBookingNumber() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `HRB-${timestamp}${random}`;
}

function safeStorageSegment(value, fallback = "file") {
  const segment = clean(value)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
  return segment || fallback;
}

function safeStorageFileName(fileName) {
  const cleaned = clean(fileName)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "government-id";
}

function governmentIdMimeType(file) {
  const extension = clean(file?.name).split(".").pop()?.toLowerCase();
  const extensionTypes = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
  };
  return file?.type || extensionTypes[extension] || "";
}

function validateGovernmentIdUpload(file) {
  if (!file || !file.name) {
    throw new Error("Government-issued ID upload is required.");
  }

  const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
  const mimeType = governmentIdMimeType(file);
  if (!allowedTypes.has(mimeType)) {
    throw new Error("Government-issued ID must be a PDF, JPG, JPEG, or PNG file.");
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Government-issued ID must be 10 MB or smaller.");
  }

  return mimeType;
}

export function createBookingReference() {
  return generateBookingNumber();
}

export async function getRoomInventory() {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("room_inventory")
    .select("id, room_type, total_rooms, available_rooms, updated_at")
    .order("room_type", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

export async function subscribeRoomInventory(onChange) {
  const supabase = await getSupabaseClient();
  const channel = supabase
    .channel("room-inventory-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "room_inventory" },
      async () => {
        try {
          onChange(await getRoomInventory());
        } catch (error) {
          console.warn("Could not refresh room inventory", error);
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function createRoomBooking(payload) {
  const checkIn = requireText(payload.checkIn, "Check-in date");
  const checkOut = requireText(payload.checkOut, "Check-out date");
  ensureCheckoutAfterCheckin(checkIn, checkOut);
  const nights = payload.nights || Math.round((new Date(`${checkOut}T00:00:00`) - new Date(`${checkIn}T00:00:00`)) / 86_400_000);
  const bookingNumber = payload.bookingNumber || generateBookingNumber();
  const roomType = requireText(payload.roomType || payload.roomName, "Room type");

  const supabase = await getSupabaseClient();
  const { data: inventoryRoom, error: inventoryError } = await supabase
    .from("room_inventory")
    .select("available_rooms")
    .eq("room_type", roomType)
    .maybeSingle();

  if (inventoryError) {
    throw inventoryError;
  }

  if (!inventoryRoom || Number(inventoryRoom.available_rooms || 0) < 1) {
    throw new Error(`${roomType} is no longer available. Please choose another room type or contact Harla Hotel.`);
  }

  const { error } = await supabase.from("room_bookings").insert({
    booking_number: bookingNumber,
    full_name: requireText(payload.fullName, "Full name"),
    phone: requireText(payload.phoneInternational || payload.phone, "Phone number"),
    email: optionalText(payload.email),
    date_of_birth: optionalText(payload.dateOfBirth),
    nationality: optionalText(payload.nationality),
    room_type: roomType,
    room_slug: optionalText(payload.roomSlug),
    room_name: optionalText(payload.roomName || payload.roomType),
    check_in: checkIn,
    check_out: checkOut,
    guests: requirePositiveNumber(payload.guests, "Number of guests"),
    payment_method: requireText(payload.paymentMethod, "Payment method"),
    payment_reference: optionalText(payload.paymentReference),
    payment_screenshot_url: optionalText(payload.paymentScreenshotUrl),
    payment_status: optionalText(payload.paymentStatus) || "submitted_for_verification",
    status: "pending",
    nights,
    number_of_rooms: numberOrNull(payload.numberOfRooms) || 1,
    price_per_night: numberOrNull(payload.pricePerNight),
    total_price: numberOrNull(payload.estimatedTotal || payload.totalPrice),
    total_price_etb: numberOrNull(payload.estimatedTotal || payload.totalPrice),
    total_price_usd: numberOrNull(payload.totalPriceUsd),
    exchange_rate: numberOrNull(payload.exchangeRate),
    exchange_rate_date: optionalText(payload.exchangeRateDate),
    payment_currency: optionalText(payload.paymentCurrency) || "ETB",
    message: optionalText(payload.message),
    government_id_path: optionalText(payload.governmentIdPath),
    government_id_file_name: optionalText(payload.governmentIdFileName),
    government_id_mime_type: optionalText(payload.governmentIdMimeType),
    government_id_file_size: numberOrNull(payload.governmentIdFileSize),
    government_id_uploaded_at: optionalText(payload.governmentIdUploadedAt),
  });

  if (error) {
    throw error;
  }

  return { booking_number: bookingNumber, status: "pending" };
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

export async function createRestaurantOrder(payload) {
  const supabase = await getSupabaseClient();
  const orderNumber = payload.orderNumber || generateOrderNumber();
  const { error } = await supabase
    .from("restaurant_orders")
    .insert({
      order_number: orderNumber,
      customer_name: requireText(payload.customerName, "Customer name"),
      phone: requireText(payload.phone, "Phone number"),
      order_type: requireText(payload.orderType, "Order type"),
      address_area: optionalText(payload.addressArea),
      custom_address: optionalText(payload.customAddress),
      items: payload.items || [],
      pastry_items: payload.pastryItems || [],
      payment_method: requireText(payload.paymentMethod, "Payment method"),
      payment_reference: optionalText(payload.paymentReference),
      payment_screenshot_url: optionalText(payload.paymentScreenshotUrl),
      payment_status: requireText(payload.paymentStatus, "Payment status"),
      status: "pending",
      odoo_status: "not_entered",
    });

  if (error) {
    throw error;
  }

  return { order_number: orderNumber, status: "pending" };
}

export async function getRestaurantSettings() {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("restaurant_settings")
    .select("id, ordering_available, custom_message, updated_at")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || { id: "default", ...defaultRestaurantSettings };
}

export async function updateRestaurantSettings(payload) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("restaurant_settings")
    .upsert(
      {
        id: "default",
        ordering_available: Boolean(payload.orderingAvailable),
        custom_message: optionalText(payload.customMessage),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    .select("id, ordering_available, custom_message, updated_at")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function getRestaurantOrderStatus(orderNumber, phone) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.rpc("get_restaurant_order_status", {
    lookup_order_number: requireText(orderNumber, "Order number"),
    lookup_phone: requireText(phone, "Phone number"),
  });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data[0] || null : data;
}

export async function getRoomBookingStatus(bookingNumber) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.rpc("get_room_booking_status", {
    lookup_booking_number: requireText(bookingNumber, "Booking number"),
  });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data[0] || null : data;
}

export async function uploadPaymentScreenshot(file, folder = "restaurant-orders") {
  if (!file || !file.name) {
    throw new Error("Payment screenshot is required.");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Payment screenshot must be an image file.");
  }

  const supabase = await getSupabaseClient();
  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const uniqueId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${folder}/${uniqueId}.${extension}`;
  const { error } = await supabase.storage.from("payment-screenshots").upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    throw error;
  }

  return path;
}

export async function uploadRoomPaymentProof(file, bookingReference) {
  if (!file || !file.name) {
    throw new Error("Payment confirmation file is required.");
  }

  const extension = clean(file.name).split(".").pop()?.toLowerCase();
  const allowedTypes = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);
  const extensionTypes = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  const mimeType = file.type || extensionTypes[extension] || "";

  if (!allowedTypes.has(mimeType) || !extensionTypes[extension]) {
    throw new Error("Payment confirmation must be PDF, JPG, JPEG, PNG, or WebP.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Payment confirmation must be 10 MB or smaller.");
  }

  const bookingFolder = safeStorageSegment(bookingReference, "room-booking");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = safeStorageFileName(file.name);
  const path = `room-bookings/${bookingFolder}/${timestamp}-${fileName}`;
  const supabase = await getSupabaseClient();
  const { error } = await supabase.storage
    .from("payment-screenshots")
    .upload(path, file, {
      cacheControl: "3600",
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    throw error;
  }

  return path;
}

export async function uploadGovernmentId(file, bookingReference) {
  const mimeType = validateGovernmentIdUpload(file);
  const bookingFolder = safeStorageSegment(bookingReference, "room-booking");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = safeStorageFileName(file.name);
  const path = `room-bookings/${bookingFolder}/${timestamp}-${fileName}`;
  const supabase = await getSupabaseClient();

  const { error } = await supabase.storage.from("guest-ids").upload(path, file, {
    cacheControl: "3600",
    contentType: mimeType,
    upsert: false,
  });

  if (error) {
    throw error;
  }

  return {
    path,
    fileName: file.name,
    mimeType,
    fileSize: file.size,
    uploadedAt: new Date().toISOString(),
  };
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
  const dashboardErrors = [];
  const queries = {
    roomBookings: supabase.from("room_bookings").select("*").order("created_at", { ascending: false }),
    eventRequests: supabase.from("event_requests").select("*").order("created_at", { ascending: false }),
    restaurantRequests: supabase.from("restaurant_requests").select("*").order("created_at", { ascending: false }),
    restaurantOrders: supabase.from("restaurant_orders").select("*").order("created_at", { ascending: false }),
    roomInventory: supabase
      .from("room_inventory")
      .select("id, room_type, total_rooms, available_rooms, updated_at")
      .order("room_type", { ascending: true }),
    restaurantSettings: supabase
      .from("restaurant_settings")
      .select("id, ordering_available, custom_message, updated_at")
      .eq("id", "default")
      .maybeSingle(),
    packageBookings: supabase.from("package_bookings").select("*").order("created_at", { ascending: false }),
  };

  const entries = await Promise.all(
    Object.entries(queries).map(async ([key, query]) => {
      const { data, error } = await query;
      if (error) {
        dashboardErrors.push({ key, message: error.message });
        return [key, dashboardFallbackValue(key)];
      }
      return [key, key === "restaurantSettings" ? data || dashboardFallbackValue(key) : data || []];
    }),
  );

  const dashboardData = Object.fromEntries(entries);
  dashboardData.dashboardErrors = dashboardErrors;
  dashboardData.roomBookings = await withSignedPaymentScreenshots(supabase, dashboardData.roomBookings || []);
  dashboardData.restaurantOrders = await withSignedPaymentScreenshots(supabase, dashboardData.restaurantOrders || []);

  return dashboardData;
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

export async function updateRoomBookingStatus(id, status) {
  const supabase = await getSupabaseClient();

  if (status === "confirmed") {
    const { data, error } = await supabase.rpc("confirm_room_booking", {
      booking_id: id,
    });

    if (error) {
      throw error;
    }

    return Array.isArray(data) ? data[0] || null : data;
  }

  if (status !== "declined" && status !== "pending") {
    throw new Error("Choose a valid room booking status.");
  }

  const { data, error } = await supabase
    .from("room_bookings")
    .update({
      status,
      confirmed_at: null,
      declined_at: status === "declined" ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function markRoomBookingContacted(id) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("room_bookings")
    .update({
      customer_contacted: true,
      contacted_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function updateRoomInventory(id, payload) {
  const totalRooms = requirePositiveNumber(payload.totalRooms, "Total rooms");
  const availableRooms = Number(payload.availableRooms);

  if (!Number.isFinite(availableRooms) || availableRooms < 0) {
    throw new Error("Available rooms must be 0 or greater.");
  }

  if (availableRooms > totalRooms) {
    throw new Error("Available rooms cannot be more than total rooms.");
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("room_inventory")
    .update({
      total_rooms: totalRooms,
      available_rooms: availableRooms,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, room_type, total_rooms, available_rooms, updated_at")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function updateRestaurantOrderStatus(id, status) {
  if (!["approved", "declined", "pending"].includes(status)) {
    throw new Error("Choose a valid restaurant order status.");
  }

  const updatePayload = {
    status,
    approved_at: status === "approved" ? new Date().toISOString() : null,
    declined_at: status === "declined" ? new Date().toISOString() : null,
  };

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("restaurant_orders")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function markRestaurantOrderEnteredInOdoo(id) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("restaurant_orders")
    .update({
      odoo_status: "entered",
      odoo_entered_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}
