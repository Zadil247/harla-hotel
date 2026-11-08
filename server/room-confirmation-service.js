import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { generateRoomConfirmationPdf } from "./room-confirmation-pdf.js";
import { normalizeRoomStatus } from "./room-workflow.js";

const confirmationBucket = "room-confirmations";
const stampBucket = "hotel-private-assets";
const stampPath = "event-confirmation/harla-official-stamp.png";
const maxPdfBytes = 5 * 1024 * 1024;
const maxStampBytes = 1024 * 1024;
const stampPixelLimit = 16_000_000;
const signedUrlLifetimeSeconds = 15 * 60;
const logoUrl = new URL("../assets/logo/harla-hotel-logo.jpeg", import.meta.url);

function confirmationPath(booking) {
  return `confirmed/${booking.booking_number}.pdf`;
}

async function officialStamp(supabase) {
  const { data, error } = await supabase.storage.from(stampBucket).download(stampPath);
  if (error || !data) {
    throw new Error("The official Harla Hotel stamp is not available in the private hotel asset bucket.");
  }
  if (data.size > maxStampBytes) throw new Error("The official Harla Hotel stamp must be 1 MB or smaller.");
  const sourceBytes = new Uint8Array(await data.arrayBuffer());
  const isPng = sourceBytes[0] === 0x89
    && sourceBytes[1] === 0x50
    && sourceBytes[2] === 0x4e
    && sourceBytes[3] === 0x47;
  const isJpeg = sourceBytes[0] === 0xff && sourceBytes[1] === 0xd8 && sourceBytes[2] === 0xff;
  if (!isPng && !isJpeg) throw new Error("The official Harla Hotel stamp must be PNG or JPEG.");

  const { data: pixels, info } = await sharp(sourceBytes, {
    failOn: "error",
    limitInputPixels: stampPixelLimit,
  }).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const highest = Math.max(red, green, blue);
    const lowest = Math.min(red, green, blue);
    if (highest - lowest <= 18 && lowest >= 218) {
      const alpha = lowest >= 246 ? 0 : Math.round(255 * ((246 - lowest) / 28));
      pixels[index + 3] = Math.min(pixels[index + 3], alpha);
    }
  }

  const bytes = await sharp(pixels, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .resize({ width: 900, height: 600, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { bytes, mimeType: "image/png" };
}

async function signedConfirmationUrl(supabase, path) {
  const { data, error } = await supabase.storage
    .from(confirmationBucket)
    .createSignedUrl(path, signedUrlLifetimeSeconds, { download: false });
  if (error || !data?.signedUrl) throw error || new Error("The stored room confirmation could not be opened.");
  return data.signedUrl;
}

export async function ensureRoomConfirmationPdf(supabase, booking, { force = false } = {}) {
  if (!["confirmed", "approved", "checked_in", "checked_out"].includes(normalizeRoomStatus(booking.status))) {
    throw new Error("An official room confirmation is available only after the booking is confirmed.");
  }

  const trustedExistingPdf = Boolean(
    booking.confirmation_pdf_path
      && booking.confirmation_pdf_generated_at
      && /^[a-f0-9]{64}$/.test(booking.confirmation_pdf_sha256 || ""),
  );
  if (trustedExistingPdf && !force) {
    return {
      generated: false,
      fileName: `Harla-Hotel-Room-Booking-${booking.booking_number}.pdf`,
      pdfPath: booking.confirmation_pdf_path,
      signedUrl: await signedConfirmationUrl(supabase, booking.confirmation_pdf_path),
    };
  }

  const generatedAt = new Date().toISOString();
  const [stamp, logoBytes] = await Promise.all([
    officialStamp(supabase),
    readFile(logoUrl).catch(() => null),
  ]);
  const pdfBytes = await generateRoomConfirmationPdf(booking, {
    logoBytes,
    logoMimeType: "image/jpeg",
    stampBytes: stamp.bytes,
    stampMimeType: stamp.mimeType,
    generatedAt,
  });
  if (!pdfBytes.length || pdfBytes.length > maxPdfBytes) {
    throw new Error("The generated room confirmation PDF exceeds the 5 MB storage limit.");
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
  if (uploadError) throw uploadError;

  const { error: updateError } = await supabase
    .from("room_bookings")
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
    fileName: `Harla-Hotel-Room-Booking-${booking.booking_number}.pdf`,
    pdfPath,
    signedUrl: await signedConfirmationUrl(supabase, pdfPath),
  };
}
