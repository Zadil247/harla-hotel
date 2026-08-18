import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { requiredEnv } from "./config.js";
import { PublicError } from "./errors.js";
import { roomAvailabilityForDates } from "./room-booking-service.js";
import { validateRoomBookingRequest } from "./room-workflow.js";

const guestIdBucket = "guest-ids";
const paymentBucket = "payment-screenshots";
const maxFileSize = 10 * 1024 * 1024;
const authorizationLifetimeMs = 15 * 60 * 1000;

const idTypes = new Map([
  ["pdf", "application/pdf"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
]);
const paymentTypes = new Map([...idTypes, ["webp", "image/webp"]]);

function uploadSecret() {
  const secret = requiredEnv("ROOM_UPLOAD_TOKEN_SECRET");
  if (secret.length < 32) {
    throw new Error("ROOM_UPLOAD_TOKEN_SECRET must contain at least 32 characters.");
  }
  return secret;
}

function safeFileName(value) {
  const normalized = String(value || "upload")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-140);
  return normalized || "upload";
}

function fileDescriptor(value, label, allowedTypes) {
  const fileName = String(value?.fileName || "").trim();
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  const expectedMimeType = allowedTypes.get(extension);
  const mimeType = String(value?.mimeType || expectedMimeType || "").trim().toLowerCase();
  const fileSize = Number(value?.fileSize);

  if (!fileName || !expectedMimeType || expectedMimeType !== mimeType) {
    throw new PublicError(`${label} has an unsupported file type.`);
  }
  if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > maxFileSize) {
    throw new PublicError(`${label} must be 10 MB or smaller.`);
  }

  return { fileName, mimeType, fileSize };
}

function storagePath(bookingNumber, fileName) {
  const stamp = Date.now();
  const nonce = randomBytes(8).toString("hex");
  return `room-bookings/${bookingNumber}/${stamp}-${nonce}-${safeFileName(fileName)}`;
}

function normalizedFingerprint(booking, files) {
  return createHash("sha256")
    .update(JSON.stringify({
      bookingNumber: booking.bookingNumber,
      roomSlug: booking.room.slug,
      roomType: booking.room.name,
      fullName: booking.fullName,
      email: booking.email,
      phone: booking.phone,
      dateOfBirth: booking.dateOfBirth,
      nationality: booking.nationality,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      guests: booking.guests,
      numberOfRooms: booking.numberOfRooms,
      paymentMethod: booking.paymentMethod,
      paymentReference: booking.paymentReference,
      paymentStatus: booking.paymentStatus,
      paymentCurrency: booking.paymentCurrency,
      totalPriceUsd: booking.totalPriceUsd,
      exchangeRate: booking.exchangeRate,
      exchangeRateDate: booking.exchangeRateDate,
      message: booking.message,
      governmentId: files.governmentId,
      paymentProof: files.paymentProof,
    }))
    .digest("hex");
}

function signPayload(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", uploadSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readPayload(token) {
  const [encoded, suppliedSignature, extra] = String(token || "").split(".");
  if (!encoded || !suppliedSignature || extra) {
    throw new PublicError("The secure upload authorization is invalid or expired.", 401);
  }

  const expectedSignature = createHmac("sha256", uploadSecret()).update(encoded).digest();
  let supplied;
  try {
    supplied = Buffer.from(suppliedSignature, "base64url");
  } catch {
    throw new PublicError("The secure upload authorization is invalid or expired.", 401);
  }
  if (supplied.length !== expectedSignature.length || !timingSafeEqual(supplied, expectedSignature)) {
    throw new PublicError("The secure upload authorization is invalid or expired.", 401);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new PublicError("The secure upload authorization is invalid or expired.", 401);
  }
  if (payload?.version !== 1 || !Number.isFinite(payload.expiresAt) || Date.now() > payload.expiresAt) {
    throw new PublicError("The secure upload authorization has expired. Please submit the payment step again.", 401);
  }
  if (
    !payload.files?.governmentId?.path
    || !payload.files?.paymentProof?.path
    || !/^HRB-[A-Z0-9]{6,32}$/.test(String(payload.bookingNumber || ""))
    || !payload.fingerprint
  ) {
    throw new PublicError("The secure upload authorization is invalid or expired.", 401);
  }
  return payload;
}

function bookingWithFiles(input, files) {
  return validateRoomBookingRequest({
    ...input,
    governmentIdPath: files.governmentId.path,
    governmentIdFileName: files.governmentId.fileName,
    governmentIdMimeType: files.governmentId.mimeType,
    governmentIdFileSize: files.governmentId.fileSize,
    governmentIdUploadedAt: files.governmentId.uploadedAt,
    paymentScreenshotUrl: files.paymentProof.path,
  });
}

async function signedUpload(supabase, bucket, descriptor) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(descriptor.path, { upsert: false });
  if (error || !data?.token) {
    throw error || new Error(`Could not authorize the ${bucket} upload.`);
  }
  return {
    bucket,
    path: descriptor.path,
    token: data.token,
    fileName: descriptor.fileName,
    mimeType: descriptor.mimeType,
    fileSize: descriptor.fileSize,
  };
}

export async function authorizeRoomBookingUploads(supabase, input, metadata = {}) {
  const bookingNumber = String(input?.bookingNumber || "").trim().toUpperCase();
  const governmentId = fileDescriptor(metadata.governmentId, "Government ID", idTypes);
  const paymentProof = fileDescriptor(metadata.paymentProof, "Payment confirmation", paymentTypes);
  const uploadedAt = new Date().toISOString();
  const files = {
    governmentId: {
      ...governmentId,
      path: storagePath(bookingNumber, governmentId.fileName),
      uploadedAt,
    },
    paymentProof: {
      ...paymentProof,
      path: storagePath(bookingNumber, paymentProof.fileName),
      uploadedAt,
    },
  };
  const booking = bookingWithFiles(input, files);
  const { data: existingBooking, error: existingBookingError } = await supabase
    .from("room_bookings")
    .select("booking_number")
    .eq("booking_number", booking.bookingNumber)
    .maybeSingle();
  if (existingBookingError) throw existingBookingError;
  if (existingBooking) {
    throw new PublicError("This booking reference has already been submitted.", 409);
  }
  const availability = await roomAvailabilityForDates(supabase, booking.checkIn, booking.checkOut);
  const inventory = availability.find((room) => room.room_type === booking.room.name);
  if (!inventory || inventory.available_rooms < booking.numberOfRooms) {
    throw new PublicError(
      "This room is no longer available for the selected dates. Please choose another room or contact Harla Hotel.",
      409,
      "room_unavailable",
    );
  }

  const fingerprint = normalizedFingerprint(booking, files);
  const authorizationToken = signPayload({
    version: 1,
    expiresAt: Date.now() + authorizationLifetimeMs,
    bookingNumber: booking.bookingNumber,
    fingerprint,
    files,
  });
  const [governmentUpload, paymentUpload] = await Promise.all([
    signedUpload(supabase, guestIdBucket, files.governmentId),
    signedUpload(supabase, paymentBucket, files.paymentProof),
  ]);

  return {
    authorizationToken,
    expiresAt: new Date(Date.now() + authorizationLifetimeMs).toISOString(),
    uploads: {
      governmentId: governmentUpload,
      paymentProof: paymentUpload,
    },
  };
}

function matchesSignature(bytes, mimeType) {
  if (mimeType === "application/pdf") {
    return Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-";
  }
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return png.every((byte, index) => bytes[index] === byte);
  }
  if (mimeType === "image/webp") {
    return Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
      && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP";
  }
  return false;
}

async function verifyStoredFile(supabase, bucket, descriptor, label) {
  const { data, error } = await supabase.storage.from(bucket).download(descriptor.path);
  if (error || !data) {
    throw new PublicError(`${label} did not finish uploading. Please try again.`);
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength !== descriptor.fileSize || !matchesSignature(bytes, descriptor.mimeType)) {
    throw new PublicError(`${label} could not be verified. Please upload the original PDF or image file.`);
  }
}

async function cleanupAuthorizedFiles(supabase, files) {
  await Promise.allSettled([
    supabase.storage.from(guestIdBucket).remove([files.governmentId.path]),
    supabase.storage.from(paymentBucket).remove([files.paymentProof.path]),
  ]);
}

async function bookingAlreadyExists(supabase, bookingNumber) {
  const { data, error } = await supabase
    .from("room_bookings")
    .select("booking_number")
    .eq("booking_number", bookingNumber)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function cancelAuthorizedRoomUploads(supabase, token) {
  const payload = readPayload(token);
  if (await bookingAlreadyExists(supabase, payload.bookingNumber)) return;
  await cleanupAuthorizedFiles(supabase, payload.files);
}

export async function completeAuthorizedRoomUploads(supabase, input, token) {
  const payload = readPayload(token);
  let booking;
  try {
    booking = bookingWithFiles(input, payload.files);
    if (normalizedFingerprint(booking, payload.files) !== payload.fingerprint) {
      throw new PublicError("Booking details changed after the secure uploads were authorized. Please try again.", 409);
    }
    await Promise.all([
      verifyStoredFile(supabase, guestIdBucket, payload.files.governmentId, "Government ID"),
      verifyStoredFile(supabase, paymentBucket, payload.files.paymentProof, "Payment confirmation"),
    ]);
  } catch (error) {
    if (!(await bookingAlreadyExists(supabase, payload.bookingNumber))) {
      await cleanupAuthorizedFiles(supabase, payload.files);
    }
    throw error;
  }

  return {
    ...input,
    governmentIdPath: booking.governmentIdPath,
    governmentIdFileName: booking.governmentIdFileName,
    governmentIdMimeType: booking.governmentIdMimeType,
    governmentIdFileSize: booking.governmentIdFileSize,
    governmentIdUploadedAt: booking.governmentIdUploadedAt,
    paymentScreenshotUrl: booking.paymentScreenshotPath,
  };
}
