import { getEtbToUsdQuote } from "../server/exchange-rate.js";
import { PublicError, publicErrorResponse } from "../server/errors.js";

export default {
  async fetch(request) {
    if (request.method !== "GET") {
      return Response.json(
        { error: "Method not allowed." },
        { status: 405, headers: { Allow: "GET" } },
      );
    }

    try {
      const url = new URL(request.url);
      const totalEtb = Number(url.searchParams.get("amount_etb"));
      if (!Number.isFinite(totalEtb) || totalEtb < 1 || totalEtb > 10_000_000) {
        throw new PublicError("Please provide a valid ETB booking total.");
      }

      const quote = await getEtbToUsdQuote(totalEtb);
      return Response.json(quote, {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      });
    } catch (error) {
      return publicErrorResponse(error);
    }
  },
};
