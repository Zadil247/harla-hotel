import { getSupabaseClient } from "./supabase-client.js?v=20260818-room-workflow-v2";

async function resultJson(response, fallback) {
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error || fallback);
    error.status = response.status;
    error.code = result?.code || "";
    throw error;
  }
  return result;
}

async function roomRequest(action, payload = {}) {
  const response = await fetch("/api/room-booking", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  return resultJson(response, "The secure room booking service could not complete this request.");
}

async function roomAdminHeaders() {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) throw new Error("Please sign in with an active Harla Hotel Room Admin account.");
  return {
    Accept: "application/json",
    Authorization: `Bearer ${data.session.access_token}`,
    "Content-Type": "application/json",
  };
}

export async function getDateAwareRoomAvailability(checkIn, checkOut) {
  const result = await roomRequest("availability", { checkIn, checkOut });
  return result.rooms || [];
}

export async function checkRoomBookingBackendReadiness() {
  return roomRequest("readiness");
}

export async function authorizeRoomBookingUploads(booking, files) {
  return roomRequest("authorize_uploads", { booking, files });
}

export async function uploadAuthorizedRoomFile(upload, file) {
  if (!upload?.bucket || !upload?.path || !upload?.token) {
    throw new Error("The secure upload authorization is incomplete.");
  }
  const supabase = await getSupabaseClient();
  const { error } = await supabase.storage
    .from(upload.bucket)
    .uploadToSignedUrl(upload.path, upload.token, file, {
      cacheControl: "3600",
      contentType: upload.mimeType,
      upsert: false,
    });
  if (error) throw error;
  return upload.path;
}

export async function cancelAuthorizedRoomUploads(uploadAuthorizationToken) {
  if (!uploadAuthorizationToken) return;
  await roomRequest("cancel_uploads", { uploadAuthorizationToken });
}

export async function submitRoomBookingWithHold(booking, uploadAuthorizationToken) {
  const result = await roomRequest("create", { booking, uploadAuthorizationToken });
  return result.booking;
}

export async function lookupRoomBookingStatus(bookingNumber, fullName) {
  try {
    const result = await roomRequest("status", { bookingNumber, fullName });
    return result.booking;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export async function roomAdminRequest(action, payload = {}) {
  const response = await fetch("/api/room-admin", {
    method: "POST",
    headers: await roomAdminHeaders(),
    body: JSON.stringify({ action, ...payload }),
  });
  return resultJson(response, "The Room Admin request failed.");
}

export async function requireRoomAdminAccess() {
  const result = await roomAdminRequest("profile");
  if (!result.profile?.active) throw new Error("This account is not an active Harla Hotel Room Admin.");
  return result.profile;
}
