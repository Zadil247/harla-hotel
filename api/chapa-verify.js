import { fulfillChapaTransaction } from "../server/chapa-fulfillment.js";
import { PublicError, publicErrorResponse } from "../server/errors.js";

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
      const txRef = new URL(request.url).searchParams.get("tx_ref");
      if (!txRef?.trim()) {
        throw new PublicError("A Chapa transaction reference is required.");
      }

      const result = await fulfillChapaTransaction(txRef);
      return Response.json(result, {
        status: responseStatus(result),
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      return publicErrorResponse(error);
    }
  },
};
