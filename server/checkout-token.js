import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { requiredEnv } from "./config.js";

function tokenForBooking(bookingNumber) {
  return createHmac("sha256", requiredEnv("BOOKING_SIGNING_SECRET"))
    .update(String(bookingNumber))
    .digest("hex");
}

export function createCheckoutCancelToken(bookingNumber) {
  return tokenForBooking(bookingNumber);
}

export function verifyCheckoutCancelToken(bookingNumber, suppliedToken) {
  const expected = Buffer.from(tokenForBooking(bookingNumber), "utf8");
  const supplied = Buffer.from(String(suppliedToken || ""), "utf8");
  return (
    supplied.length === expected.length &&
    timingSafeEqual(supplied, expected)
  );
}
