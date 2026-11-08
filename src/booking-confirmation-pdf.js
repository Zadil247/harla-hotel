import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import { images, siteConfig } from "./data.js?v=20260521-room-automation";

function safe(value) {
  return value || "-";
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-ET", {
    dateStyle: "medium",
  }).format(new Date(`${value}`.includes("T") ? value : `${value}T00:00:00`));
}

async function imageToDataUrl(src) {
  const response = await fetch(src);
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function addDetail(doc, label, value, x, y) {
  doc.setFont("helvetica", "bold");
  doc.setTextColor(76, 52, 19);
  doc.text(label, x, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(35, 35, 35);
  doc.text(String(safe(value)), x + 58, y);
}

export async function downloadBookingConfirmationPdf(booking) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  const gold = [199, 155, 43];
  const charcoal = [35, 35, 35];
  const cream = [255, 247, 231];

  doc.setFillColor(...charcoal);
  doc.rect(0, 0, pageWidth, 118, "F");
  doc.setFillColor(...gold);
  doc.rect(0, 118, pageWidth, 5, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text("Harla Hotel", margin, 48);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(siteConfig.address, margin, 68);
  doc.text(`${siteConfig.phone}  |  ${siteConfig.email}`, margin, 84);
  doc.text("Official Booking Confirmation", margin, 100);

  try {
    const logoData = await imageToDataUrl(images.logo);
    doc.addImage(logoData, "JPEG", pageWidth - 128, 24, 76, 76);
  } catch (error) {
    doc.setTextColor(...gold);
    doc.setFont("helvetica", "bold");
    doc.text("HH", pageWidth - 94, 66);
  }

  doc.setFillColor(...cream);
  doc.roundedRect(margin, 154, pageWidth - margin * 2, 84, 8, 8, "F");
  doc.setTextColor(...charcoal);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Dear Guest,", margin + 22, 184);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(
    "Thank you for choosing Harla Hotel. We are pleased to confirm your room booking as detailed below.",
    margin + 22,
    208,
    { maxWidth: pageWidth - margin * 2 - 44 },
  );

  doc.setDrawColor(...gold);
  doc.setLineWidth(1);
  doc.roundedRect(margin, 270, pageWidth - margin * 2, 284, 8, 8, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...charcoal);
  doc.text("Booking Details", margin + 22, 304);

  doc.setFontSize(10);
  addDetail(doc, "Booking No.", safe(booking.booking_number), margin + 22, 336);
  addDetail(doc, "Guest Name", safe(booking.full_name || booking.customer_name), margin + 22, 360);
  addDetail(doc, "Phone", safe(booking.phone), margin + 22, 384);
  addDetail(doc, "Email", safe(booking.email), margin + 22, 408);
  addDetail(doc, "Room Type", safe(booking.room_type || booking.room_name), margin + 22, 432);
  addDetail(doc, "Check-in", formatDate(booking.check_in), margin + 22, 456);
  addDetail(doc, "Check-out", formatDate(booking.check_out), margin + 22, 480);
  addDetail(doc, "Guests", safe(booking.guests), margin + 22, 504);
  addDetail(doc, "Payment", safe(booking.payment_method), margin + 22, 528);

  doc.setFillColor(...charcoal);
  doc.roundedRect(margin, 584, pageWidth - margin * 2, 72, 8, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Payment Confirmation", margin + 22, 614);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(
    `Payment status: ${safe(booking.payment_status)}. Booking status: ${safe(booking.status)}.`,
    margin + 22,
    636,
    { maxWidth: pageWidth - margin * 2 - 44 },
  );

  doc.setTextColor(...charcoal);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(
    "We look forward to welcoming you to Harla Hotel and sharing warm Harari hospitality throughout your stay.",
    margin,
    704,
    { maxWidth: pageWidth - margin * 2 },
  );

  doc.setFont("helvetica", "bold");
  doc.text("Harla Hotel Reservations Team", margin, 746);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Please bring this confirmation or your booking number during check-in.", margin, 790);

  doc.save(`Harla-Hotel-${safe(booking.booking_number)}.pdf`);
}
