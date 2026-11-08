import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { generateEventHallConfirmationPdf } from "../server/event-confirmation-pdf.js";

const stampSvg = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="360" height="220" viewBox="0 0 360 220">
    <rect width="360" height="220" fill="none" />
    <ellipse cx="180" cy="110" rx="140" ry="76" fill="none" stroke="#b98b24" stroke-width="9" />
    <text x="180" y="101" text-anchor="middle" font-family="Arial" font-size="28" font-weight="700" fill="#2b2924">HARLA HOTEL</text>
    <text x="180" y="137" text-anchor="middle" font-family="Arial" font-size="19" fill="#b98b24">OFFICIAL TEST STAMP</text>
  </svg>`);
const stampBytes = await sharp(stampSvg).png().toBuffer();

const baseBooking = {
  booking_reference: "HARLA-HALL-2026-0099",
  client_full_name: "Muna Yusuf",
  organization: "Harar Culture Forum",
  email: "muna@example.com",
  phone: "+251 911 000 000",
  address: "Harar, Ethiopia",
  hall_name: "Harla Hotel Event Hall",
  event_type: "Conference",
  event_date: "2026-10-10",
  start_time: "10:00",
  end_time: "14:00",
  attendees: 80,
  refreshments_services: [
    { name: "Coffee", quantity: 80, quantityLabel: "Servings" },
    { name: "Lunch", quantity: 80, quantityLabel: "Guests" },
  ],
  special_requests: "Projector, registration desk, and classroom seating.",
  quoted_amount: 45000,
  quoted_currency: "ETB",
  payment_status: "verified",
  status: "confirmed",
};

const assets = {
  stampBytes,
  stampMimeType: "image/png",
  generatedAt: "2026-08-17T21:30:00Z",
};
const normalBytes = await generateEventHallConfirmationPdf(baseBooking, assets);
const normalPdf = await PDFDocument.load(normalBytes);
assert.equal(normalPdf.getPageCount(), 1, "A normal confirmation must fit on one A4 page.");

const overnightBytes = await generateEventHallConfirmationPdf({
  ...baseBooking,
  start_time: "20:00",
  end_time: "01:00",
}, assets);
const overnightPdf = await PDFDocument.load(overnightBytes);
assert.equal(overnightPdf.getPageCount(), 1, "An overnight confirmation must fit on one A4 page.");

const longBooking = {
  ...baseBooking,
  refreshments_services: Array.from({ length: 42 }, (_, index) => ({
    name: `Service arrangement ${index + 1} with preparation and table coordination`,
    quantity: 80,
    quantityLabel: "Guests",
  })),
  special_requests: "Provide separate registration, interpretation, accessible seating, photography, and ceremonial areas. ".repeat(12),
};
const longBytes = await generateEventHallConfirmationPdf(longBooking, assets);
const longPdf = await PDFDocument.load(longBytes);
assert.ok(longPdf.getPageCount() > 1, "Long content should flow onto continuation pages.");

const normalPath = join(tmpdir(), "harla-event-confirmation-normal.pdf");
const longPath = join(tmpdir(), "harla-event-confirmation-long.pdf");
await Promise.all([writeFile(normalPath, normalBytes), writeFile(longPath, longBytes)]);
console.log(`PDF checks passed: normal=${normalPdf.getPageCount()} page, long=${longPdf.getPageCount()} pages.`);
console.log(`Rendered test files: ${normalPath}, ${longPath}`);
