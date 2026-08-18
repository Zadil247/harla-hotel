import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { generateRoomConfirmationPdf } from "../server/room-confirmation-pdf.js";

const stampBytes = await sharp({
  create: {
    width: 480,
    height: 260,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{
    input: Buffer.from(
      '<svg width="480" height="260"><ellipse cx="240" cy="130" rx="205" ry="95" fill="none" stroke="#1d5f9f" stroke-width="12"/><text x="240" y="144" text-anchor="middle" font-family="Arial" font-size="42" font-weight="700" fill="#1d5f9f">HARLA HOTEL</text></svg>',
    ),
  }])
  .png()
  .toBuffer();
const logoBytes = await readFile(new URL("../assets/logo/harla-hotel-logo.jpeg", import.meta.url));
const booking = {
  booking_number: "HRB-TEST01",
  full_name: "Room Workflow Test Guest",
  room_type: "Twin Bed Room",
  number_of_rooms: 1,
  check_in: "2026-08-20",
  check_out: "2026-08-23",
  nights: 3,
  guests: 2,
  total_price_etb: 13500,
  payment_status: "verified",
  status: "confirmed",
};

const pdfBytes = await generateRoomConfirmationPdf(booking, {
  logoBytes,
  logoMimeType: "image/jpeg",
  stampBytes,
  stampMimeType: "image/png",
  generatedAt: "2026-08-18T12:00:00+03:00",
});
const pdf = await PDFDocument.load(pdfBytes);
assert.equal(pdf.getPageCount(), 1, "normal room confirmation must fit one A4 page");
assert.deepEqual(pdf.getPage(0).getSize(), { width: 595.28, height: 841.89 });
assert.ok(pdfBytes.length > 1000 && pdfBytes.length < 5 * 1024 * 1024);

const outputPath = join(tmpdir(), "harla-room-confirmation-test.pdf");
await writeFile(outputPath, pdfBytes);
console.log(`Room confirmation PDF test passed: one A4 page with embedded logo/stamp (${outputPath}).`);
