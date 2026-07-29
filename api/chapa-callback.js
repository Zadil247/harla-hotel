import { fulfillChapaTransaction } from "../server/chapa-fulfillment.js";
import { PublicError, publicErrorResponse } from "../server/errors.js";

function transactionReference(url) {
  for (const name of [
    "tx_ref",
    "trx_ref",
    "transaction_reference",
    "transaction_ref",
    "reference",
  ]) {
    const value = url.searchParams.get(name);
    if (value?.trim()) {
      return value.trim();
    }
  }
  throw new PublicError(
    "The Chapa callback did not include a transaction reference.",
  );
}

function responseStatus(result) {
  if (result.confirmed) {
    return 200;
  }
  if (["failed", "cancelled"].includes(result.paymentStatus)) {
    return 409;
  }
  return 202;
}

export default {
  async fetch(request) {
    if (request.method !== "GET") {
      return Response.json(
        { error: "Method not allowed." },
        { status: 405, headers: { Allow: "GET" } },
      );
    }

    try {
      const result = await fulfillChapaTransaction(
        transactionReference(new URL(request.url)),
      );
      return Response.json(
        {
          confirmed: result.confirmed,
          paymentStatus: result.paymentStatus,
          bookingNumber: result.bookingNumber,
        },
        {
          status: responseStatus(result),
          headers: { "Cache-Control": "no-store" },
        },
      );
    } catch (error) {
      return publicErrorResponse(error);
    }
  },
};
