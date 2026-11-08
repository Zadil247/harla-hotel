import { findRoomPricing } from "../src/room-pricing.js";
import { PublicError } from "./errors.js";

export const roomBookingNumberPattern = /^HRB-[A-Z0-9]{6,32}$/;
export const roomBlockingStatuses = new Set([
  "pending",
  "pending_review",
  "pending_payment_review",
  "pending_payment_confirmation",
  "approved",
  "confirmed",
  "checked_in",
]);

const allowedPaymentStatuses = new Set([
  "pending_payment_confirmation",
  "pending_payment_review",
  "submitted_for_verification",
]);
const allowedIdMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,63}$/;

export function cleanRoomText(value) {
  return String(value ?? "").trim();
}

export function normalizeRoomStatus(value) {
  return cleanRoomText(value).toLowerCase() || "pending";
}

export function normalizeGuestName(value) {
  return cleanRoomText(value).replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function requiredText(value, label, maxLength = 255) {
  const text = cleanRoomText(value);
  if (!text) throw new PublicError(`${label} is required.`);
  if (text.length > maxLength) throw new PublicError(`${label} is too long.`);
  return text;
}

function validDate(value, label) {
  const text = requiredText(value, label, 10);
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new PublicError(`${label} is invalid.`);
  }
  return text;
}

export function ethiopiaTodayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Addis_Ababa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function validateStayDates(checkInValue, checkOutValue) {
  const checkIn = validDate(checkInValue, "Check-in date");
  const checkOut = validDate(checkOutValue, "Check-out date");
  const start = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  const nights = Math.round((end - start) / 86_400_000);
  if (checkIn < ethiopiaTodayIso()) {
    throw new PublicError("Check-in cannot be in the past.");
  }
  if (nights < 1 || nights > 365) {
    throw new PublicError("Check-out must be after check-in and the stay cannot exceed 365 nights.");
  }
  return { checkIn, checkOut, nights };
}

function pathBelongsToBooking(path, bookingNumber, label) {
  const cleanPath = requiredText(path, label, 700);
  if (!cleanPath.startsWith(`room-bookings/${bookingNumber}/`)) {
    throw new PublicError(`${label} storage path is invalid.`);
  }
  return cleanPath;
}

export function validateRoomBookingRequest(input) {
  const bookingNumber = requiredText(input.bookingNumber, "Booking reference", 40).toUpperCase();
  if (!roomBookingNumberPattern.test(bookingNumber)) {
    throw new PublicError("Booking reference format is invalid.");
  }

  const room = findRoomPricing(input.roomSlug || input.roomType);
  if (!room || room.name !== cleanRoomText(input.roomType)) {
    throw new PublicError("Please choose a valid Harla Hotel room.");
  }

  const fullName = requiredText(input.fullName, "Full name", 160);
  const email = requiredText(input.email, "Email address", 254).toLowerCase();
  if (!emailPattern.test(email)) throw new PublicError("Please enter a valid email address.");
  const phone = requiredText(input.phoneInternational || input.phone, "Phone number", 40);
  if (!/^\+[1-9]\d{6,14}$/.test(phone.replace(/[\s()-]/g, ""))) {
    throw new PublicError("Please enter a valid international phone number.");
  }

  const dateOfBirth = validDate(input.dateOfBirth, "Date of birth");
  if (dateOfBirth >= ethiopiaTodayIso()) throw new PublicError("Date of birth must be in the past.");
  const nationality = requiredText(input.nationality, "Nationality", 100);
  const { checkIn, checkOut, nights } = validateStayDates(input.checkIn, input.checkOut);
  const guests = Number(input.guests);
  const numberOfRooms = Number(input.numberOfRooms || 1);
  if (!Number.isInteger(guests) || guests < 1 || guests > 20) {
    throw new PublicError("Number of guests must be between 1 and 20.");
  }
  if (!Number.isInteger(numberOfRooms) || numberOfRooms < 1 || numberOfRooms > 20) {
    throw new PublicError("Number of rooms must be between 1 and 20.");
  }

  const paymentMethod = requiredText(input.paymentMethod, "Payment method", 80);
  const paymentReference = requiredText(input.paymentReference, "Payment reference", 160);
  const paymentStatus = cleanRoomText(input.paymentStatus).toLowerCase();
  if (!allowedPaymentStatuses.has(paymentStatus)) {
    throw new PublicError("Choose a valid pending payment status.");
  }
  const paymentCurrency = requiredText(input.paymentCurrency || "ETB", "Payment currency", 3).toUpperCase();
  if (!["ETB", "USD"].includes(paymentCurrency)) {
    throw new PublicError("Payment currency must be ETB or USD.");
  }

  const governmentIdMimeType = requiredText(input.governmentIdMimeType, "Government ID type", 100);
  const governmentIdFileSize = Number(input.governmentIdFileSize);
  if (!allowedIdMimeTypes.has(governmentIdMimeType)) {
    throw new PublicError("Government ID must be PDF, JPG, JPEG, or PNG.");
  }
  if (!Number.isInteger(governmentIdFileSize) || governmentIdFileSize < 1 || governmentIdFileSize > 10 * 1024 * 1024) {
    throw new PublicError("Government ID must be 10 MB or smaller.");
  }

  return {
    bookingNumber,
    room,
    fullName,
    email,
    phone,
    dateOfBirth,
    nationality,
    checkIn,
    checkOut,
    nights,
    guests,
    numberOfRooms,
    paymentMethod,
    paymentReference,
    paymentStatus,
    paymentCurrency,
    paymentScreenshotPath: pathBelongsToBooking(
      input.paymentScreenshotUrl,
      bookingNumber,
      "Payment confirmation",
    ),
    totalPriceUsd: Number(input.totalPriceUsd) > 0 ? Number(input.totalPriceUsd) : null,
    exchangeRate: Number(input.exchangeRate) > 0 ? Number(input.exchangeRate) : null,
    exchangeRateDate: input.exchangeRateDate ? validDate(input.exchangeRateDate, "Exchange-rate date") : null,
    message: cleanRoomText(input.message).slice(0, 2000) || null,
    governmentIdPath: pathBelongsToBooking(input.governmentIdPath, bookingNumber, "Government ID"),
    governmentIdFileName: requiredText(input.governmentIdFileName, "Government ID file name", 255),
    governmentIdMimeType,
    governmentIdFileSize,
    governmentIdUploadedAt: cleanRoomText(input.governmentIdUploadedAt) || new Date().toISOString(),
  };
}

export function roomStatusLabel(value) {
  const labels = {
    pending: "Pending Review",
    pending_review: "Pending Review",
    pending_payment_review: "Pending Review",
    pending_payment_confirmation: "Pending Review",
    approved: "Confirmed",
    confirmed: "Confirmed",
    checked_in: "Checked In",
    checked_out: "Checked Out",
    declined: "Declined",
    rejected: "Declined",
    cancelled: "Cancelled",
  };
  const normalized = normalizeRoomStatus(value);
  return labels[normalized] || normalized.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function paymentStatusLabel(value) {
  const labels = {
    pending: "Payment Pending Verification",
    pending_verification: "Payment Pending Verification",
    pending_payment_review: "Payment Pending Verification",
    pending_payment_confirmation: "Payment Pending Verification",
    submitted_for_verification: "Payment Pending Verification",
    verified: "Payment Verified",
    paid: "Paid",
    declined: "Payment Declined",
    failed: "Payment Failed",
    cancelled: "Payment Cancelled",
  };
  const normalized = normalizeRoomStatus(value);
  return labels[normalized] || normalized.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function safeRoomBookingRecord(booking, confirmationUrl = "") {
  return {
    booking_number: booking.booking_number,
    full_name: booking.full_name,
    room_type: booking.room_type,
    check_in: booking.check_in,
    check_out: booking.check_out,
    nights: booking.nights,
    guests: booking.guests,
    number_of_rooms: booking.number_of_rooms,
    payment_method: booking.payment_method,
    payment_status: booking.payment_status,
    status: booking.status,
    decline_reason: booking.decline_reason,
    confirmed_at: booking.confirmed_at,
    declined_at: booking.declined_at,
    created_at: booking.created_at,
    confirmation_pdf_url: confirmationUrl || "",
  };
}
