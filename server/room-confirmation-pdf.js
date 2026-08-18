import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { paymentStatusLabel, roomStatusLabel } from "./room-workflow.js";

const A4 = [595.28, 841.89];
const margin = 48;
const palette = {
  charcoal: rgb(0.105, 0.105, 0.1),
  gold: rgb(0.77, 0.59, 0.17),
  goldDark: rgb(0.49, 0.35, 0.06),
  cream: rgb(0.976, 0.965, 0.933),
  white: rgb(1, 1, 1),
  gray: rgb(0.38, 0.37, 0.34),
  line: rgb(0.86, 0.82, 0.73),
};

function safe(value, fallback = "-") {
  return (String(value ?? "").trim() || fallback)
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
}

function formatDate(value) {
  if (!value) return "-";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
    : new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : new Intl.DateTimeFormat("en-ET", {
        dateStyle: "long",
        timeZone: "Africa/Addis_Ababa",
      }).format(date);
}

function formatMoney(booking) {
  const value = Number(booking.total_price_etb ?? booking.total_price ?? 0);
  return value > 0 ? `${value.toLocaleString("en-US")} ETB` : "Recorded by Harla Hotel";
}

async function embedImage(pdf, bytes, mimeType = "") {
  if (!bytes?.length) return null;
  const isPng = mimeType.includes("png") || (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  );
  return isPng ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
}

function fitText(font, text, initialSize, maxWidth, minimumSize = 7.5) {
  let size = initialSize;
  while (size > minimumSize && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  return size;
}

export async function generateRoomConfirmationPdf(booking, assets = {}) {
  if (!assets.stampBytes?.length) {
    throw new Error("The official Harla Hotel stamp is not configured.");
  }

  const pdf = await PDFDocument.create();
  const page = pdf.addPage(A4);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedImage(pdf, assets.logoBytes, assets.logoMimeType).catch(() => null);
  const stamp = await embedImage(pdf, assets.stampBytes, assets.stampMimeType);
  const generatedAt = assets.generatedAt ? new Date(assets.generatedAt) : new Date();
  const contentWidth = A4[0] - margin * 2;

  pdf.setTitle(`Harla Hotel Room Booking Confirmation ${safe(booking.booking_number)}`);
  pdf.setSubject("Official room booking confirmation");
  pdf.setAuthor("Harla Hotel");
  pdf.setCreator("Harla Hotel Secure Confirmation Service");
  pdf.setProducer("Harla Hotel Secure Confirmation Service");
  pdf.setCreationDate(Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt);

  page.drawRectangle({ x: 0, y: A4[1] - 118, width: A4[0], height: 118, color: palette.charcoal });
  page.drawRectangle({ x: 0, y: A4[1] - 118, width: A4[0], height: 4, color: palette.gold });
  page.drawText("HARLA HOTEL", { x: margin, y: A4[1] - 42, size: 23, font: bold, color: palette.white });
  page.drawText("ROOM BOOKING CONFIRMATION", { x: margin, y: A4[1] - 64, size: 10, font: bold, color: palette.gold });
  page.drawText("Harar, Ethiopia", { x: margin, y: A4[1] - 84, size: 8.5, font: regular, color: palette.white });
  page.drawText("+251 915 321 188  |  booking@harlahotel.com", {
    x: margin,
    y: A4[1] - 100,
    size: 8.5,
    font: regular,
    color: palette.white,
  });

  if (logo) {
    const scaled = logo.scaleToFit(58, 58);
    page.drawRectangle({ x: A4[0] - 116, y: A4[1] - 88, width: 68, height: 64, color: palette.white });
    page.drawImage(logo, {
      x: A4[0] - 111 + (58 - scaled.width) / 2,
      y: A4[1] - 85 + (58 - scaled.height) / 2,
      width: scaled.width,
      height: scaled.height,
    });
  }

  const issued = new Intl.DateTimeFormat("en-ET", {
    dateStyle: "long",
    timeZone: "Africa/Addis_Ababa",
  }).format(Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt);
  page.drawText(`ISSUED ${safe(issued).toUpperCase()}`, {
    x: margin,
    y: A4[1] - 145,
    size: 8,
    font: regular,
    color: palette.gray,
  });
  const reference = `REFERENCE ${safe(booking.booking_number)}`;
  page.drawText(reference, {
    x: A4[0] - margin - bold.widthOfTextAtSize(reference, 8),
    y: A4[1] - 145,
    size: 8,
    font: bold,
    color: palette.goldDark,
  });

  page.drawRectangle({ x: margin, y: A4[1] - 228, width: contentWidth, height: 60, color: palette.cream });
  page.drawText(`Dear ${safe(booking.full_name, "Guest")},`, {
    x: margin + 18,
    y: A4[1] - 190,
    size: 13,
    font: bold,
    color: palette.charcoal,
  });
  page.drawText("Thank you for choosing Harla Hotel. Your room booking is confirmed as detailed below.", {
    x: margin + 18,
    y: A4[1] - 211,
    size: 9.2,
    font: regular,
    color: palette.gray,
  });

  const details = [
    ["Guest", safe(booking.full_name)],
    ["Room type", safe(booking.room_type || booking.room_name)],
    ["Number of rooms", safe(booking.number_of_rooms || 1)],
    ["Check-in", formatDate(booking.check_in)],
    ["Check-out", formatDate(booking.check_out)],
    ["Nights", safe(booking.nights)],
    ["Guests", safe(booking.guests)],
    ["Final amount", formatMoney(booking)],
  ];
  const detailsTop = A4[1] - 265;
  const columnWidth = (contentWidth - 18) / 2;
  details.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = margin + column * (columnWidth + 18);
    const y = detailsTop - row * 62;
    page.drawText(label.toUpperCase(), { x, y, size: 7.5, font: bold, color: palette.goldDark });
    const text = safe(value);
    const size = fitText(regular, text, 10.5, columnWidth - 4);
    page.drawText(text, { x, y: y - 18, size, font: regular, color: palette.charcoal });
    page.drawLine({
      start: { x, y: y - 31 },
      end: { x: x + columnWidth, y: y - 31 },
      thickness: 0.7,
      color: palette.line,
    });
  });

  const statusY = 266;
  page.drawRectangle({ x: margin, y: statusY, width: contentWidth, height: 72, color: palette.charcoal });
  page.drawText("PAYMENT & BOOKING STATUS", {
    x: margin + 18,
    y: statusY + 48,
    size: 8,
    font: bold,
    color: palette.gold,
  });
  page.drawText(paymentStatusLabel(booking.payment_status), {
    x: margin + 18,
    y: statusY + 25,
    size: 11,
    font: bold,
    color: palette.white,
  });
  const bookingStatus = roomStatusLabel(booking.status);
  page.drawText(bookingStatus, {
    x: A4[0] - margin - 18 - bold.widthOfTextAtSize(bookingStatus, 11),
    y: statusY + 25,
    size: 11,
    font: bold,
    color: palette.white,
  });

  page.drawText("Please keep this confirmation and present your booking reference during check-in.", {
    x: margin,
    y: 225,
    size: 9.5,
    font: regular,
    color: palette.gray,
  });
  page.drawText("We look forward to welcoming you with warm Harari hospitality.", {
    x: margin,
    y: 207,
    size: 9.5,
    font: regular,
    color: palette.gray,
  });

  page.drawLine({
    start: { x: margin, y: 132 },
    end: { x: A4[0] - margin, y: 132 },
    thickness: 0.8,
    color: palette.line,
  });
  page.drawText("Harla Hotel Reservations Team", {
    x: margin,
    y: 106,
    size: 10,
    font: bold,
    color: palette.charcoal,
  });
  page.drawText("Authorized confirmation", {
    x: margin,
    y: 89,
    size: 8.5,
    font: regular,
    color: palette.gray,
  });

  const stampScaled = stamp.scaleToFit(118, 82);
  page.drawImage(stamp, {
    x: A4[0] - margin - stampScaled.width,
    y: 48,
    width: stampScaled.width,
    height: stampScaled.height,
  });

  return new Uint8Array(await pdf.save());
}
