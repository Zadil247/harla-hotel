import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { requiredEnv } from "./config.js";
import { generateEventHallConfirmationPdf } from "./event-confirmation-pdf.js";

const confirmationBucket = "event-confirmations";
const stampBucket = "hotel-private-assets";
const maxPdfBytes = 5 * 1024 * 1024;
const maxStampBytes = 1024 * 1024;
const signedUrlLifetimeSeconds = 15 * 60;
const logoUrl = new URL("../assets/logo/harla-hotel-logo.jpeg", import.meta.url);
const stampPixelLimit = 16_000_000;

function safeStampPath() {
  const path = requiredEnv("HARLA_EVENT_STAMP_PATH");
  if (path.startsWith("/") || path.includes("..") || !/^[a-zA-Z0-9/_-]+\.(png|jpe?g)$/i.test(path)) {
    throw new Error("HARLA_EVENT_STAMP_PATH must be a safe PNG or JPEG path in hotel-private-assets.");
  }
  return path;
}

function confirmationPath(booking) {
  const source = booking.booking_source === "WEBSITE" ? "website" : "admin";
  return `${source}/${booking.booking_reference}.pdf`;
}

async function officialStamp(supabase) {
  const path = safeStampPath();
  const { data, error } = await supabase.storage.from(stampBucket).download(path);
  if (error || !data) {
    throw new Error(
      "The official Harla Hotel event stamp is not available in the secure server asset bucket.",
    );
  }
  if (data.size > maxStampBytes) {
    throw new Error("The official event stamp must be 1 MB or smaller.");
  }
  const sourceBytes = new Uint8Array(await data.arrayBuffer());
  const isPng = sourceBytes[0] === 0x89
    && sourceBytes[1] === 0x50
    && sourceBytes[2] === 0x4e
    && sourceBytes[3] === 0x47;
  const isJpeg = sourceBytes[0] === 0xff
    && sourceBytes[1] === 0xd8
    && sourceBytes[2] === 0xff;
  if (!isPng && !isJpeg) {
    throw new Error("The official event stamp must be a PNG or JPEG image.");
  }

  const { data: pixels, info } = await sharp(sourceBytes, {
    failOn: "error",
    limitInputPixels: stampPixelLimit,
  })
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Official stamp scans often arrive on a white or pale-gray rectangle. Fade
  // only near-neutral bright pixels, preserving gold and dark stamp artwork.
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const highest = Math.max(red, green, blue);
    const lowest = Math.min(red, green, blue);
    if (highest - lowest <= 18 && lowest >= 218) {
      const backgroundAlpha = lowest >= 246
        ? 0
        : Math.round(255 * ((246 - lowest) / 28));
      pixels[index + 3] = Math.min(pixels[index + 3], backgroundAlpha);
    }
  }

  const normalizedBytes = await sharp(pixels, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .resize({
      width: 900,
      height: 600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return {
    bytes: normalizedBytes,
    mimeType: "image/png",
  };
}

async function signedConfirmationUrl(supabase, path) {
  const { data, error } = await supabase.storage
    .from(confirmationBucket)
    .createSignedUrl(path, signedUrlLifetimeSeconds, { download: false });
  if (error || !data?.signedUrl) {
    throw error || new Error("The stored event confirmation could not be opened.");
  }
  return data.signedUrl;
}

export async function ensureEventHallConfirmationPdf(
  supabase,
  booking,
  { force = false } = {},
) {
  if (!["confirmed", "completed"].includes(String(booking.status || "").toLowerCase())) {
    throw new Error("An official Event Hall confirmation is available only after the reservation is confirmed.");
  }
  const trustedExistingPdf = Boolean(
    booking.confirmation_pdf_path
      && booking.confirmation_pdf_generated_at
      && /^[a-f0-9]{64}$/.test(booking.confirmation_pdf_sha256 || ""),
  );

  if (trustedExistingPdf && !force) {
    return {
      generated: false,
      fileName: `Harla-Hotel-Hall-Booking-${booking.booking_reference}.pdf`,
      pdfPath: booking.confirmation_pdf_path,
      signedUrl: await signedConfirmationUrl(supabase, booking.confirmation_pdf_path),
    };
  }

  const generatedAt = new Date().toISOString();
  const [stamp, logoBytes] = await Promise.all([
    officialStamp(supabase),
    readFile(logoUrl).catch(() => null),
  ]);
  const pdfBytes = await generateEventHallConfirmationPdf(booking, {
    logoBytes,
    logoMimeType: "image/jpeg",
    stampBytes: stamp.bytes,
    stampMimeType: stamp.mimeType,
    generatedAt,
  });

  if (!pdfBytes.length || pdfBytes.length > maxPdfBytes) {
    throw new Error("The generated event confirmation PDF exceeds the 5 MB storage limit.");
  }

  const pdfPath = confirmationPath(booking);
  const sha256 = createHash("sha256").update(pdfBytes).digest("hex");
  const { error: uploadError } = await supabase.storage
    .from(confirmationBucket)
    .upload(pdfPath, pdfBytes, {
      cacheControl: "3600",
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadError) {
    throw uploadError;
  }

  const { error: updateError } = await supabase
    .from("event_hall_bookings")
    .update({
      confirmation_pdf_path: pdfPath,
      confirmation_pdf_generated_at: generatedAt,
      confirmation_pdf_sha256: sha256,
    })
    .eq("id", booking.id);
  if (updateError) {
    await supabase.storage.from(confirmationBucket).remove([pdfPath]);
    throw updateError;
  }

  return {
    generated: true,
    fileName: `Harla-Hotel-Hall-Booking-${booking.booking_reference}.pdf`,
    pdfPath,
    signedUrl: await signedConfirmationUrl(supabase, pdfPath),
  };
}
