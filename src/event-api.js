import { getSupabaseClient } from "./supabase-client.js?v=20260521-room-automation";

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

async function adminHeaders() {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) throw new Error("Please sign in with an active Events Team account.");
  return {
    Accept: "application/json",
    Authorization: `Bearer ${data.session.access_token}`,
    "Content-Type": "application/json",
  };
}

export async function checkEventHallAvailability(payload) {
  const response = await fetch("/api/event-request", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "availability", ...payload }),
  });
  return resultJson(response, "Hall availability could not be checked.");
}

export async function checkEventRequestBackendReadiness() {
  const response = await fetch("/api/event-request", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "readiness" }),
  });
  return resultJson(response, "Event request services could not be verified.");
}

export async function submitEventHallRequest(payload) {
  const response = await fetch("/api/event-request", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return resultJson(response, "The Event Hall request could not be submitted.");
}

export async function lookupEventRequest(reference, token) {
  const response = await fetch("/api/event-portal", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "lookup", reference, token }),
  });
  return resultJson(response, "The Event Hall request could not be opened.");
}

export async function submitEventPaymentProof(reference, token, paymentReference, paymentProof) {
  const form = new FormData();
  form.set("action", "upload_payment");
  form.set("reference", reference);
  form.set("token", token);
  form.set("paymentReference", paymentReference);
  form.set("paymentProof", paymentProof);
  const response = await fetch("/api/event-portal", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: form,
  });
  return resultJson(response, "The payment confirmation could not be uploaded.");
}

export async function eventAdminRequest(action, payload = {}) {
  const response = await fetch("/api/event-admin", {
    method: "POST",
    headers: await adminHeaders(),
    body: JSON.stringify({ action, ...payload }),
  });
  return resultJson(response, "The Event Hall admin request failed.");
}

export async function getEventAdminProfile() {
  return eventAdminRequest("profile");
}

export async function requireEventAdminAccess() {
  const result = await getEventAdminProfile();
  if (!result.profile?.active) throw new Error("This account is not an active Harla Hotel Events Team admin.");
  return result.profile;
}

export async function generateEventAdminConfirmation(bookingReference, regenerate = false) {
  const response = await fetch("/api/event-confirmation", {
    method: "POST",
    headers: await adminHeaders(),
    body: JSON.stringify({ bookingReference, regenerate }),
  });
  return resultJson(response, "The official Event Hall confirmation could not be prepared.");
}
