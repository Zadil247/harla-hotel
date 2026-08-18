import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const A4 = [595.28, 841.89];
const margin = 48;
const contentBottom = 58;
const ethiopiaTimeZone = "Africa/Addis_Ababa";
const palette = {
  charcoal: rgb(0.118, 0.118, 0.114),
  gold: rgb(0.745, 0.569, 0.141),
  goldDark: rgb(0.494, 0.357, 0.063),
  warmGray: rgb(0.412, 0.388, 0.345),
  cream: rgb(0.976, 0.965, 0.933),
  white: rgb(1, 1, 1),
  line: rgb(0.871, 0.839, 0.776),
};

const reservationStatusLabels = {
  pending: "Pending Review",
  pending_review: "Pending Review",
  needs_information: "Additional Information Required",
  approved_awaiting_payment: "Approved - Awaiting Payment",
  payment_submitted: "Payment Submitted - Awaiting Verification",
  confirmed: "Confirmed",
  completed: "Completed",
  rejected: "Request Not Available",
  cancelled: "Cancelled",
};

const paymentStatusLabels = {
  not_submitted: "Payment Not Submitted",
  pending: "Payment Pending Verification",
  pending_payment_confirmation: "Payment Pending Verification",
  verified: "Payment Verified",
  paid: "Paid",
  declined: "Payment Declined",
  failed: "Payment Failed",
  cancelled: "Payment Cancelled",
};

function safe(value, fallback = "-") {
  const text = String(value ?? "").trim() || fallback;
  return text
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
}

function humanizeStatus(value, type) {
  const normalized = String(value || "").trim().toLowerCase();
  const mapped = type === "payment"
    ? paymentStatusLabels[normalized]
    : reservationStatusLabels[normalized];
  if (mapped) {
    return mapped;
  }
  return safe(normalized || "status unavailable")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function documentTitle(booking) {
  return ["confirmed", "completed"].includes(String(booking.status || "").toLowerCase())
    ? "Event Hall Booking Confirmation"
    : "Event Hall Reservation Acknowledgement";
}

function eventType(booking) {
  return String(booking.event_type || "").toLowerCase() === "other"
    ? safe(booking.custom_event_type, "Other")
    : safe(booking.event_type);
}

function dateFormatter() {
  return new Intl.DateTimeFormat("en-ET", {
    dateStyle: "long",
    timeZone: ethiopiaTimeZone,
  });
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly
    ? new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : dateFormatter().format(date);
}

function formatIssuedDate(value) {
  const date = value ? new Date(value) : new Date();
  return dateFormatter().format(Number.isNaN(date.getTime()) ? new Date() : date);
}

function formatTime(value) {
  if (!value) {
    return "-";
  }
  const [hours, minutes] = String(value).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return "-";
  }
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function formatTimeRange(startTime, endTime) {
  const start = String(startTime || "");
  const end = String(endTime || "");
  const nextDay = end && start && end < start ? " (next day)" : "";
  return `${formatTime(startTime)} to ${formatTime(endTime)}${nextDay}`;
}

function services(value) {
  return Array.isArray(value)
    ? value.filter((item) => item?.name).map((item) => {
        const quantity = Number(item.quantity) > 0
          ? `, ${item.quantity} ${String(item.quantityLabel || "quantity").toLowerCase()}`
          : "";
        const notes = item.notes ? `, ${item.notes}` : "";
        return `${item.name}${quantity}${notes}`;
      })
    : [];
}

function wrapText(font, text, size, maxWidth) {
  const words = safe(text, "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) {
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

async function embedImage(pdf, bytes, mimeType = "") {
  if (!bytes?.length) {
    return null;
  }
  const png = mimeType.includes("png") || (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  );
  return png ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
}

export async function generateEventHallConfirmationPdf(booking, assets = {}) {
  if (!assets.stampBytes?.length) {
    throw new Error("The official Harla Hotel event stamp is not configured.");
  }

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedImage(pdf, assets.logoBytes, assets.logoMimeType).catch(() => null);
  const stamp = await embedImage(pdf, assets.stampBytes, assets.stampMimeType);
  const contentWidth = A4[0] - margin * 2;
  const title = documentTitle(booking);
  const generatedAt = assets.generatedAt ? new Date(assets.generatedAt) : new Date();
  let page;
  let y;

  pdf.setTitle(`Harla Hotel ${title} ${safe(booking.booking_reference)}`);
  pdf.setSubject(title);
  pdf.setAuthor("Harla Hotel");
  pdf.setCreator("Harla Hotel Secure Confirmation Service");
  pdf.setProducer("Harla Hotel Secure Confirmation Service");
  pdf.setCreationDate(Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt);

  function drawFirstPageHeader() {
    page.drawRectangle({ x: 0, y: A4[1] - 112, width: A4[0], height: 112, color: palette.charcoal });
    page.drawRectangle({ x: 0, y: A4[1] - 112, width: A4[0], height: 4, color: palette.gold });
    page.drawText("HARLA HOTEL", { x: margin, y: A4[1] - 40, size: 23, font: bold, color: palette.white });
    page.drawText(title, { x: margin, y: A4[1] - 61, size: 10, font: regular, color: palette.white });
    page.drawText("Harar, Ethiopia", { x: margin, y: A4[1] - 80, size: 8.5, font: regular, color: palette.white });
    page.drawText("+251 915 321 188  |  events@harlahotel.com", {
      x: margin,
      y: A4[1] - 96,
      size: 8.5,
      font: regular,
      color: palette.white,
    });

    if (logo) {
      const scaled = logo.scaleToFit(58, 58);
      page.drawRectangle({ x: A4[0] - 116, y: A4[1] - 87, width: 68, height: 64, color: palette.white });
      page.drawImage(logo, {
        x: A4[0] - 111 + (58 - scaled.width) / 2,
        y: A4[1] - 84 + (58 - scaled.height) / 2,
        width: scaled.width,
        height: scaled.height,
      });
    }
    y = A4[1] - 134;
  }

  function drawContinuationHeader() {
    page.drawRectangle({ x: 0, y: A4[1] - 58, width: A4[0], height: 58, color: palette.charcoal });
    page.drawRectangle({ x: 0, y: A4[1] - 58, width: A4[0], height: 3, color: palette.gold });
    page.drawText(title, { x: margin, y: A4[1] - 34, size: 13, font: bold, color: palette.white });
    const reference = safe(booking.booking_reference);
    page.drawText(reference, {
      x: A4[0] - margin - regular.widthOfTextAtSize(reference, 8.5),
      y: A4[1] - 33,
      size: 8.5,
      font: regular,
      color: palette.gold,
    });
    y = A4[1] - 82;
  }

  function newPage(continuation = false) {
    page = pdf.addPage(A4);
    if (continuation) {
      drawContinuationHeader();
    } else {
      drawFirstPageHeader();
    }
  }

  function ensureSpace(height) {
    if (y - height < contentBottom) {
      newPage(true);
      return true;
    }
    return false;
  }

  function drawWrapped(text, options = {}) {
    const size = options.size || 9.5;
    const lineHeight = options.lineHeight || size + 3;
    const font = options.font || regular;
    const x = options.x ?? margin;
    const width = options.width ?? contentWidth;
    const lines = wrapText(font, text, size, width);
    ensureSpace(lines.length * lineHeight + 2);
    lines.forEach((line) => {
      page.drawText(line, {
        x,
        y,
        size,
        font,
        color: options.color || palette.charcoal,
      });
      y -= lineHeight;
    });
    return lines.length;
  }

  function sectionHeading(titleText, minimumContentHeight = 0) {
    ensureSpace(23 + minimumContentHeight);
    page.drawLine({
      start: { x: margin, y: y - 2 },
      end: { x: margin + 18, y: y - 2 },
      thickness: 1.5,
      color: palette.gold,
    });
    page.drawText(titleText, {
      x: margin + 27,
      y: y - 6,
      size: 11.5,
      font: bold,
      color: palette.charcoal,
    });
    y -= 23;
  }

  function prepareCardRows(rows, cardWidth) {
    const labelWidth = 61;
    const valueWidth = cardWidth - labelWidth - 21;
    const prepared = rows
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
      .map(([label, value]) => {
        const lines = wrapText(regular, value, 8.7, valueWidth);
        return {
          label: safe(label).toUpperCase(),
          lines,
          height: Math.max(16, lines.length * 10.5 + 4),
        };
      });
    return {
      rows: prepared,
      labelWidth,
      height: 34 + prepared.reduce((sum, row) => sum + row.height, 0) + 8,
    };
  }

  function drawDetailCard(cardTitle, prepared, x, topY, width, height) {
    page.drawRectangle({ x, y: topY - height, width, height, color: palette.cream });
    page.drawRectangle({ x, y: topY - 3, width, height: 3, color: palette.gold });
    page.drawText(cardTitle, {
      x: x + 12,
      y: topY - 22,
      size: 10.5,
      font: bold,
      color: palette.charcoal,
    });

    let rowY = topY - 41;
    prepared.rows.forEach((row, rowIndex) => {
      page.drawText(row.label, {
        x: x + 12,
        y: rowY,
        size: 7,
        font: bold,
        color: palette.goldDark,
      });
      row.lines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: x + 12 + prepared.labelWidth,
          y: rowY - lineIndex * 10.5,
          size: 8.7,
          font: regular,
          color: palette.charcoal,
        });
      });
      rowY -= row.height;
      if (rowIndex < prepared.rows.length - 1) {
        page.drawLine({
          start: { x: x + 12, y: rowY + 5 },
          end: { x: x + width - 12, y: rowY + 5 },
          thickness: 0.35,
          color: palette.line,
        });
      }
    });
  }

  function drawDetailColumns() {
    const gap = 12;
    const cardWidth = (contentWidth - gap) / 2;
    const client = prepareCardRows([
      ["Client", booking.client_full_name],
      ["Organization", booking.organization],
      ["Email", booking.email],
      ["Phone", booking.phone],
      ["Address", booking.address],
    ], cardWidth);
    const reservation = prepareCardRows([
      ["Hall", booking.hall_name],
      ["Event", eventType(booking)],
      ["Date", formatDate(booking.event_date)],
      ["Time", formatTimeRange(booking.start_time, booking.end_time)],
      ["Guests", booking.attendees],
      ["Final Amount", booking.quoted_amount
        ? `${Number(booking.quoted_amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${booking.quoted_currency || "ETB"}`
        : null],
    ], cardWidth);
    const height = Math.max(client.height, reservation.height);
    ensureSpace(height);
    const topY = y;
    drawDetailCard("Client Information", client, margin, topY, cardWidth, height);
    drawDetailCard("Reservation Details", reservation, margin + cardWidth + gap, topY, cardWidth, height);
    y -= height + 10;
  }

  function drawFlowingLines(lines, options) {
    const { titleText, continuedTitle, prefix = "", size = 9.2, lineHeight = 12.2 } = options;
    lines.forEach((line, lineIndex) => {
      const wrapped = wrapText(regular, `${prefix}${line}`, size, contentWidth - 4);
      wrapped.forEach((wrappedLine) => {
        if (y - lineHeight < contentBottom) {
          newPage(true);
          sectionHeading(continuedTitle || `${titleText} (continued)`, lineHeight);
        }
        page.drawText(wrappedLine, {
          x: margin + 4,
          y,
          size,
          font: regular,
          color: palette.charcoal,
        });
        y -= lineHeight;
      });
      if (lineIndex < lines.length - 1) {
        y -= 1;
      }
    });
  }

  function drawStatusAndAuthorization() {
    const finalBlockHeight = 156;
    ensureSpace(finalBlockHeight);
    sectionHeading("Payment and Reservation Status", 52 + 78);

    page.drawRectangle({ x: margin, y: y - 49, width: contentWidth, height: 52, color: palette.charcoal });
    page.drawText("PAYMENT STATUS", { x: margin + 16, y: y - 15, size: 7.5, font: bold, color: palette.white });
    page.drawText("RESERVATION STATUS", {
      x: margin + contentWidth / 2,
      y: y - 15,
      size: 7.5,
      font: bold,
      color: palette.white,
    });
    page.drawText(humanizeStatus(booking.payment_status, "payment"), {
      x: margin + 16,
      y: y - 36,
      size: 9.5,
      font: bold,
      color: palette.gold,
    });
    page.drawText(humanizeStatus(booking.status, "reservation"), {
      x: margin + contentWidth / 2,
      y: y - 36,
      size: 9.5,
      font: bold,
      color: palette.gold,
    });
    y -= 62;

    const closingTop = y;
    const closingText = String(booking.status || "").toLowerCase() === "pending"
      ? "Your request is awaiting review by the Harla Hotel events team. We will contact you to confirm availability and final arrangements."
      : "Thank you for choosing Harla Hotel. Our events team remains available to assist with your event arrangements.";
    const closingLines = wrapText(regular, closingText, 9.2, 310);
    closingLines.forEach((line, index) => {
      page.drawText(line, {
        x: margin,
        y: closingTop - index * 12.2,
        size: 9.2,
        font: regular,
        color: palette.charcoal,
      });
    });
    page.drawText("Harla Hotel Events Team", {
      x: margin,
      y: closingTop - closingLines.length * 12.2 - 8,
      size: 9.5,
      font: bold,
      color: palette.charcoal,
    });

    const stampSize = stamp.scaleToFit(102, 64);
    const stampX = A4[0] - margin - stampSize.width;
    const stampY = closingTop - 60;
    page.drawImage(stamp, {
      x: stampX,
      y: stampY,
      width: stampSize.width,
      height: stampSize.height,
    });
    const authorization = ["confirmed", "completed"].includes(String(booking.status || "").toLowerCase())
      ? "AUTHORIZED CONFIRMATION"
      : "AUTHORIZED ACKNOWLEDGEMENT";
    page.drawText(authorization, {
      x: A4[0] - margin - bold.widthOfTextAtSize(authorization, 7),
      y: stampY - 10,
      size: 7,
      font: bold,
      color: palette.goldDark,
    });
    y = stampY - 18;
  }

  newPage();
  page.drawText(`ISSUED ${safe(formatIssuedDate(generatedAt)).toUpperCase()}`, {
    x: margin,
    y,
    size: 8,
    font: regular,
    color: palette.warmGray,
  });
  const reference = `REFERENCE ${safe(booking.booking_reference)}`;
  page.drawText(reference, {
    x: A4[0] - margin - bold.widthOfTextAtSize(reference, 8),
    y,
    size: 8,
    font: bold,
    color: palette.goldDark,
  });
  y -= 24;

  drawWrapped(`Dear ${safe(booking.client_full_name, "Client")},`, {
    size: 15,
    lineHeight: 18,
    font: bold,
  });
  y -= 2;
  const isConfirmed = ["confirmed", "completed"].includes(String(booking.status || "").toLowerCase());
  drawWrapped(
    isConfirmed
      ? "Thank you for choosing Harla Hotel. This document confirms the event hall booking and arrangements recorded below."
      : "Thank you for choosing Harla Hotel. This acknowledgement records the event hall reservation request received by our team. It remains subject to review.",
    { size: 9.2, lineHeight: 12.2 },
  );
  y -= 9;

  drawDetailColumns();

  sectionHeading("Refreshments and Services", 14);
  const selectedServices = services(booking.refreshments_services);
  drawFlowingLines(
    selectedServices.length ? selectedServices : ["No refreshments or additional services were selected."],
    {
      titleText: "Refreshments and Services",
      continuedTitle: "Refreshments and Services (continued)",
      prefix: selectedServices.length ? "- " : "",
    },
  );

  if (booking.special_requests) {
    y -= 7;
    sectionHeading("Additional Requests", 14);
    drawFlowingLines([booking.special_requests], {
      titleText: "Additional Requests",
      continuedTitle: "Additional Requests (continued)",
    });
  }

  y -= 9;
  drawStatusAndAuthorization();

  const pages = pdf.getPages();
  pages.forEach((currentPage, index) => {
    currentPage.drawLine({
      start: { x: margin, y: 39 },
      end: { x: A4[0] - margin, y: 39 },
      thickness: 0.5,
      color: palette.line,
    });
    currentPage.drawText("Harla Hotel  |  Harar, Ethiopia  |  +251 915 321 188", {
      x: margin,
      y: 22,
      size: 7.5,
      font: regular,
      color: palette.warmGray,
    });
    if (pages.length > 1) {
      const pageText = `Page ${index + 1} of ${pages.length}`;
      currentPage.drawText(pageText, {
        x: A4[0] - margin - regular.widthOfTextAtSize(pageText, 7.5),
        y: 22,
        size: 7.5,
        font: regular,
        color: palette.warmGray,
      });
    }
  });

  return pdf.save({ useObjectStreams: true });
}
