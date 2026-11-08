import {
  assertEventTransition,
  cleanText,
  eventSlotRange,
  hashPortalToken,
  initialPortalToken,
  matchesPortalToken,
  normalizeEventStatus,
  publicEventRecord,
  rotatePortalToken,
  safeFileName,
  validatePaymentProof,
} from "./event-workflow.js";

const referencePattern = /^HARLA-HALL-\d{4}-\d{4,}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validSources = new Set(["WEBSITE", "WALK_IN", "PHONE", "ADMIN_OTHER"]);

function ethiopiaDateIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Addis_Ababa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function optional(value) {
  return cleanText(value) || null;
}

function eventTypeValue(payload) {
  return cleanText(payload.eventType);
}

function validateCoreRequest(payload) {
  const name = cleanText(payload.clientFullName);
  const email = cleanText(payload.email).toLowerCase();
  const phone = cleanText(payload.phone);
  const eventType = eventTypeValue(payload);
  const attendees = Number(payload.attendees);

  if (!/^[0-9a-f-]{36}$/i.test(cleanText(payload.submissionToken))) {
    throw new Error("A valid request token is required.");
  }
  if (!cleanText(payload.hallId)) throw new Error("Please choose an event hall.");
  if (name.length < 2 || name.length > 160) throw new Error("Please enter the client full name.");
  if (!emailPattern.test(email) || email.length > 254) throw new Error("Please enter a valid email address.");
  if (phone.length < 7 || phone.length > 40) throw new Error("Please enter a valid phone number.");
  if (!eventType || eventType.length > 80) throw new Error("Please choose an event type.");
  if (eventType.toLowerCase() === "other" && !cleanText(payload.customEventType)) {
    throw new Error("Please describe the event type.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanText(payload.eventDate))) {
    throw new Error("Please choose a valid event date.");
  }
  if (payload.eventDate < ethiopiaDateIso()) {
    throw new Error("Please choose today or a future event date.");
  }
  if (!/^\d{2}:\d{2}$/.test(cleanText(payload.startTime)) || !/^\d{2}:\d{2}$/.test(cleanText(payload.endTime))) {
    throw new Error("Please choose valid start and end times.");
  }
  if (!eventSlotRange({
    eventDate: payload.eventDate,
    startTime: payload.startTime,
    endTime: payload.endTime,
  })) {
    throw new Error("Start time and end time cannot be the same.");
  }
  if (!Number.isInteger(attendees) || attendees < 1 || attendees > 10000) {
    throw new Error("Please enter a valid number of attendees.");
  }
  if (!Array.isArray(payload.refreshmentsServices)) {
    throw new Error("Refreshments and services must be a list.");
  }
  if (cleanText(payload.specialRequests).length > 1500) {
    throw new Error("Additional requests must be 1500 characters or fewer.");
  }
  return { name, email, phone, eventType, attendees };
}

async function activeHall(supabase, id) {
  const { data, error } = await supabase
    .from("event_halls")
    .select("id, slug, name, hall_type, capacity, is_active")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("The selected event hall is not available.");
  return data;
}

export async function eventSlotAvailable(supabase, payload, excludeBookingId = null) {
  const { data, error } = await supabase.rpc("event_hall_slot_is_available", {
    p_hall_id: cleanText(payload.hallId),
    p_event_date: cleanText(payload.eventDate),
    p_start_time: cleanText(payload.startTime),
    p_end_time: cleanText(payload.endTime),
    p_exclude_booking_id: excludeBookingId,
  });
  if (error) throw error;
  return data === true;
}

async function nextReference(supabase) {
  const { data, error } = await supabase.rpc("next_event_hall_booking_reference");
  if (error || !referencePattern.test(data || "")) {
    throw error || new Error("The Event Hall reference could not be generated.");
  }
  return data;
}

export async function createEventRequestRecord(supabase, payload, options = {}) {
  const validated = validateCoreRequest(payload);
  const source = cleanText(options.source || "WEBSITE").toUpperCase();
  if (!validSources.has(source)) throw new Error("Choose a valid booking source.");

  const { data: existing, error: existingError } = await supabase
    .from("event_hall_bookings")
    .select("*")
    .eq("submission_token", payload.submissionToken)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    const token = initialPortalToken(payload.submissionToken);
    return {
      booking: existing,
      portalToken: matchesPortalToken(existing.portal_token_hash, token) ? token : "",
      existing: true,
    };
  }

  const hall = await activeHall(supabase, payload.hallId);
  if (hall.capacity && validated.attendees > Number(hall.capacity)) {
    throw new Error(`${hall.name} supports up to ${hall.capacity} attendees.`);
  }
  if (!(await eventSlotAvailable(supabase, payload))) {
    throw new Error("This hall is unavailable for the selected date and time. Please choose another time or contact Harla Hotel.");
  }

  const requestedStatus = normalizeEventStatus(options.status || "pending_review");
  if (!["pending_review", "approved_awaiting_payment"].includes(requestedStatus)) {
    throw new Error("Choose a valid initial Event Hall status.");
  }
  const quotedAmount = Number(options.quotedAmount);
  if (requestedStatus === "approved_awaiting_payment") {
    if (!Number.isFinite(quotedAmount) || quotedAmount <= 0) throw new Error("A valid quoted amount is required.");
    if (!cleanText(options.paymentInstructions)) throw new Error("Payment instructions are required.");
  }

  const reference = await nextReference(supabase);
  const portalToken = initialPortalToken(payload.submissionToken);
  const now = new Date().toISOString();
  const insert = {
    booking_reference: reference,
    submission_token: payload.submissionToken,
    booking_source: source,
    hall_id: hall.id,
    hall_name: hall.name,
    hall_type: hall.hall_type,
    client_full_name: validated.name,
    organization: optional(payload.organization),
    email: validated.email,
    phone: validated.phone,
    address: optional(payload.address),
    event_type: validated.eventType,
    custom_event_type: validated.eventType.toLowerCase() === "other" ? optional(payload.customEventType) : null,
    event_date: payload.eventDate,
    start_time: payload.startTime,
    end_time: payload.endTime,
    attendees: validated.attendees,
    refreshments_services: payload.refreshmentsServices,
    special_requests: optional(payload.specialRequests),
    payment_method: "payment_arranged_later",
    payment_status: "not_submitted",
    status: requestedStatus,
    email_status: "pending",
    portal_token_hash: hashPortalToken(portalToken),
    portal_token_issued_at: now,
    quoted_amount: requestedStatus === "approved_awaiting_payment" ? quotedAmount : null,
    quoted_currency: cleanText(options.quotedCurrency || "ETB").toUpperCase(),
    quoted_at: requestedStatus === "approved_awaiting_payment" ? now : null,
    approved_at: requestedStatus === "approved_awaiting_payment" ? now : null,
    payment_instructions: requestedStatus === "approved_awaiting_payment" ? cleanText(options.paymentInstructions) : null,
    payment_deadline: requestedStatus === "approved_awaiting_payment" ? optional(options.paymentDeadline) : null,
    created_by: options.createdBy || null,
  };

  const { data: booking, error } = await supabase
    .from("event_hall_bookings")
    .insert(insert)
    .select("*")
    .single();
  if (error) {
    if (error.code === "23P01") {
      throw new Error("This hall is unavailable for the selected date and time. Please choose another time or contact Harla Hotel.");
    }
    throw error;
  }
  return { booking, portalToken, existing: false };
}

export async function bookingForPortal(supabase, reference, token) {
  const normalizedReference = cleanText(reference).toUpperCase();
  if (!referencePattern.test(normalizedReference) || !cleanText(token)) return null;
  const { data, error } = await supabase
    .from("event_hall_bookings")
    .select("*")
    .eq("booking_reference", normalizedReference)
    .maybeSingle();
  if (error) throw error;
  if (!data?.portal_token_hash || !matchesPortalToken(data.portal_token_hash, token)) return null;
  return data;
}

export async function signedEventConfirmation(supabase, booking) {
  if (!["confirmed", "completed"].includes(normalizeEventStatus(booking.status)) || !booking.confirmation_pdf_path) {
    return "";
  }
  const { data, error } = await supabase.storage
    .from("event-confirmations")
    .createSignedUrl(booking.confirmation_pdf_path, 15 * 60, { download: false });
  if (error) throw error;
  return data?.signedUrl || "";
}

export async function portalResponse(supabase, booking) {
  return publicEventRecord(booking, await signedEventConfirmation(supabase, booking));
}

export async function uploadPortalPayment(supabase, booking, token, file, reference) {
  if (!matchesPortalToken(booking.portal_token_hash, token)) {
    throw new Error("The secure Event Hall request link is invalid or expired.");
  }
  if (normalizeEventStatus(booking.status) !== "approved_awaiting_payment") {
    throw new Error("Payment confirmation can only be uploaded after the Events Team approves the request.");
  }
  const paymentReference = cleanText(reference);
  if (!paymentReference || paymentReference.length > 160) {
    throw new Error("Please enter a valid payment reference.");
  }
  const { mimeType } = validatePaymentProof(file);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `event-hall-bookings/${booking.booking_reference}/${timestamp}-${safeFileName(file.name)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from("payment-screenshots")
    .upload(path, bytes, { contentType: mimeType, cacheControl: "3600", upsert: false });
  if (uploadError) throw uploadError;

  const { data: updated, error: updateError } = await supabase
    .from("event_hall_bookings")
    .update({
      payment_reference: paymentReference,
      payment_screenshot_path: path,
      payment_status: "pending_payment_confirmation",
      payment_submitted_at: new Date().toISOString(),
      payment_rejection_reason: null,
      status: "payment_submitted",
    })
    .eq("id", booking.id)
    .eq("status", "approved_awaiting_payment")
    .select("*")
    .maybeSingle();
  if (updateError || !updated) {
    await supabase.storage.from("payment-screenshots").remove([path]);
    throw updateError || new Error("The request changed before the payment confirmation was saved. Please refresh and try again.");
  }
  return updated;
}

export async function syncStableBookingPortalToken(supabase, booking) {
  const submissionToken = cleanText(booking?.submission_token);
  if (!booking?.id || !submissionToken) {
    throw new Error("The Event Hall request cannot issue a secure customer link.");
  }

  const portalToken = initialPortalToken(submissionToken);
  if (matchesPortalToken(booking.portal_token_hash, portalToken)) {
    return { booking, portalToken };
  }

  const { data, error } = await supabase
    .from("event_hall_bookings")
    .update({
      portal_token_hash: hashPortalToken(portalToken),
      portal_token_issued_at: new Date().toISOString(),
    })
    .eq("id", booking.id)
    .select("*")
    .single();
  if (error) throw error;
  return { booking: data, portalToken };
}

export async function rotateBookingPortalToken(supabase, bookingId) {
  const portalToken = rotatePortalToken();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("event_hall_bookings")
    .update({
      portal_token_hash: hashPortalToken(portalToken),
      portal_token_issued_at: now,
      portal_token_rotated_at: now,
    })
    .eq("id", bookingId)
    .select("*")
    .single();
  if (error) throw error;
  return { booking: data, portalToken };
}

export async function adminEventRows(supabase) {
  const { data: bookings, error } = await supabase
    .from("event_hall_bookings")
    .select("*")
    .order("event_date", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) throw error;

  return Promise.all((bookings || []).map(async (booking) => {
    const row = { ...booking };
    if (booking.payment_screenshot_path) {
      const { data } = await supabase.storage
        .from("payment-screenshots")
        .createSignedUrl(booking.payment_screenshot_path, 60 * 60);
      row.payment_screenshot_display_url = data?.signedUrl || "";
    }
    if (booking.confirmation_pdf_path) {
      const { data } = await supabase.storage
        .from("event-confirmations")
        .createSignedUrl(booking.confirmation_pdf_path, 60 * 60, { download: false });
      row.confirmation_pdf_display_url = data?.signedUrl || "";
    }
    return row;
  }));
}

export async function updateEventByAdmin(supabase, booking, action, payload = {}) {
  const now = new Date().toISOString();
  const expectedStatus = cleanText(booking.status);
  let nextStatus = normalizeEventStatus(booking.status);
  const values = {};

  if (action === "needs_information") {
    nextStatus = assertEventTransition(booking.status, "needs_information");
    if (!cleanText(payload.message)) throw new Error("Enter the information needed from the customer.");
    values.needs_information_message = cleanText(payload.message);
  } else if (action === "approve_quote") {
    nextStatus = assertEventTransition(booking.status, "approved_awaiting_payment");
    const amount = Number(payload.quotedAmount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid quoted amount.");
    if (!cleanText(payload.paymentInstructions)) throw new Error("Enter payment instructions.");
    values.quoted_amount = amount;
    values.quoted_currency = cleanText(payload.quotedCurrency || "ETB").toUpperCase();
    values.quoted_at = now;
    values.approved_at = now;
    values.payment_instructions = cleanText(payload.paymentInstructions);
    values.payment_deadline = optional(payload.paymentDeadline);
    values.needs_information_message = null;
    values.decline_reason = null;
  } else if (action === "reject") {
    nextStatus = assertEventTransition(booking.status, "rejected");
    values.decline_reason = optional(payload.reason) || "The requested arrangement is not available.";
    values.rejected_at = now;
  } else if (action === "cancel") {
    nextStatus = assertEventTransition(booking.status, "cancelled");
    values.decline_reason = optional(payload.reason) || "Reservation cancelled by the Events Team.";
    values.cancelled_at = now;
  } else if (action === "request_replacement") {
    nextStatus = assertEventTransition(booking.status, "approved_awaiting_payment");
    values.payment_status = "declined";
    values.payment_rejection_reason = optional(payload.reason) || "Please upload a clearer or corrected payment confirmation.";
    values.payment_screenshot_path = null;
  } else if (action === "verify_confirm") {
    nextStatus = assertEventTransition(booking.status, "confirmed");
    if (!booking.payment_screenshot_path) throw new Error("Payment confirmation is required before confirming the reservation.");
    values.payment_status = "verified";
    values.payment_verified_at = now;
    values.confirmed_at = now;
    values.payment_rejection_reason = null;
  } else if (action === "complete") {
    nextStatus = assertEventTransition(booking.status, "completed");
    values.completed_at = now;
  } else {
    throw new Error("Choose a valid Event Hall admin action.");
  }

  const { data, error } = await supabase
    .from("event_hall_bookings")
    .update({ ...values, status: nextStatus })
    .eq("id", booking.id)
    .eq("status", expectedStatus)
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === "23P01") {
      throw new Error("This hall is already held or confirmed during the selected time.");
    }
    throw error;
  }
  if (!data) {
    const staleError = new Error("This request changed while you were reviewing it. Refresh and try again.");
    staleError.status = 409;
    staleError.code = "stale_event_request";
    throw staleError;
  }
  if (action === "request_replacement" && booking.payment_screenshot_path) {
    const { error: removeError } = await supabase.storage
      .from("payment-screenshots")
      .remove([booking.payment_screenshot_path]);
    if (removeError) {
      console.error("Superseded Event Hall payment proof cleanup failed", {
        bookingReference: booking.booking_reference,
        code: removeError.code || "storage_remove_failed",
      });
    }
  }
  return data;
}
