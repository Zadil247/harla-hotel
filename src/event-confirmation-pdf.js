function confirmationUrl(booking) {
  const url = String(booking?.confirmation_pdf_display_url || "").trim();
  if (!url) {
    throw new Error("The official confirmation PDF is not available yet.");
  }
  return url;
}

export function eventConfirmationFileName(booking) {
  const reference = String(booking?.booking_reference || "Confirmation").trim();
  return `Harla-Hotel-Hall-Booking-${reference}.pdf`;
}

export async function downloadEventHallConfirmationPdf(booking) {
  const response = await fetch(confirmationUrl(booking));
  if (!response.ok) {
    throw new Error("The secure confirmation link expired. Please request the document again.");
  }

  const blob = await response.blob();
  if (blob.type !== "application/pdf") {
    throw new Error("The stored confirmation document is not a valid PDF.");
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = eventConfirmationFileName(booking);
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function openPrintableEventHallConfirmation(booking, preparedWindow = null) {
  const target = preparedWindow || window.open("", "_blank");
  if (!target) {
    throw new Error("The printable confirmation was blocked. Allow pop-ups and try again.");
  }

  target.location.replace(confirmationUrl(booking));
  return target;
}
