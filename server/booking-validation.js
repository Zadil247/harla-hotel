import { findRoomPricing } from "../src/room-pricing.js";
import { PublicError } from "./errors.js";

const bookingNumberPattern = /^HRB-[A-Z0-9]{6,32}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,63}$/;
const allowedIdMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

function requiredText(value, label, maxLength = 255) {
  const text = String(value || "").trim();
  if (!text) {
    throw new PublicError(`${label} is required.`);
  }
  if (text.length > maxLength) {
    throw new PublicError(`${label} is too long.`);
  }
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

function nightsBetween(checkIn, checkOut) {
  const start = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  const nights = Math.round((end - start) / 86_400_000);
  if (nights < 1 || nights > 365) {
    throw new PublicError(
      "Check-out must be after check-in and the stay cannot exceed 365 nights.",
    );
  }
  return nights;
}

function validateBooking(input, { allowEthiopian }) {
  const bookingNumber = requiredText(
    input.bookingNumber,
    "Booking reference",
    40,
  ).toUpperCase();
  if (!bookingNumberPattern.test(bookingNumber)) {
    throw new PublicError("Booking reference format is invalid.");
  }

  const room = findRoomPricing(input.roomSlug || input.roomType);
  if (!room) {
    throw new PublicError("Please choose a valid Harla Hotel room.");
  }

  const fullName = requiredText(input.fullName, "Full name", 160);
  const email = requiredText(input.email, "Email address", 254).toLowerCase();
  if (!emailPattern.test(email)) {
    throw new PublicError("Please enter a valid email address.");
  }

  const phone = requiredText(
    input.phoneInternational || input.phone,
    "Phone number",
    40,
  );
  if (!/^\+[1-9]\d{6,14}$/.test(phone.replace(/[\s()-]/g, ""))) {
    throw new PublicError("Please enter a valid international phone number.");
  }

  const dateOfBirth = validDate(input.dateOfBirth, "Date of birth");
  if (new Date(`${dateOfBirth}T00:00:00Z`) >= new Date()) {
    throw new PublicError("Date of birth must be in the past.");
  }

  const nationality = requiredText(input.nationality, "Nationality", 100);
  const nationalityCountryCode = requiredText(
    input.nationalityCountryCode,
    "Nationality country code",
    2,
  ).toUpperCase();
  if (!allowEthiopian && nationalityCountryCode === "ET") {
    throw new PublicError(
      "Ethiopian guests must use CBE, Telebirr, or E-Birr.",
    );
  }

  const checkIn = validDate(input.checkIn, "Check-in date");
  const checkOut = validDate(input.checkOut, "Check-out date");
  const nights = nightsBetween(checkIn, checkOut);
  const guests = Number(input.guests);
  if (!Number.isInteger(guests) || guests < 1 || guests > 20) {
    throw new PublicError("Number of guests must be between 1 and 20.");
  }

  const governmentIdPath = requiredText(
    input.governmentIdPath,
    "Government ID file",
    500,
  );
  if (!governmentIdPath.startsWith(`room-bookings/${bookingNumber}/`)) {
    throw new PublicError("Government ID storage path is invalid.");
  }

  const governmentIdMimeType = requiredText(
    input.governmentIdMimeType,
    "Government ID file type",
    100,
  );
  if (!allowedIdMimeTypes.has(governmentIdMimeType)) {
    throw new PublicError("Government ID must be PDF, JPG, JPEG, or PNG.");
  }

  const governmentIdFileSize = Number(input.governmentIdFileSize);
  if (
    !Number.isInteger(governmentIdFileSize) ||
    governmentIdFileSize < 1 ||
    governmentIdFileSize > 10 * 1024 * 1024
  ) {
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
    nationalityCountryCode,
    checkIn,
    checkOut,
    nights,
    guests,
    message: String(input.message || "").trim().slice(0, 2000) || null,
    governmentIdPath,
    governmentIdFileName: requiredText(
      input.governmentIdFileName,
      "Government ID file name",
      255,
    ),
    governmentIdMimeType,
    governmentIdFileSize,
    governmentIdUploadedAt:
      String(input.governmentIdUploadedAt || "").trim() ||
      new Date().toISOString(),
  };
}

export function validateInternationalBooking(input) {
  return validateBooking(input, { allowEthiopian: false });
}

export function validateChapaBooking(input) {
  return validateBooking(input, { allowEthiopian: true });
}
