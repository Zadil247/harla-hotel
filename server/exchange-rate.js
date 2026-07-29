import { ConfigurationError, PublicError } from "./errors.js";

const providerBaseUrl = "https://v6.exchangerate-api.com/v6";
const providerOpenUrl = "https://open.er-api.com/v6/latest/USD";

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export async function getEtbToUsdQuote(totalEtb) {
  const amountEtb = Number(totalEtb);
  if (!Number.isFinite(amountEtb) || amountEtb <= 0) {
    throw new PublicError("A positive ETB booking total is required.");
  }

  const apiKey = String(process.env.EXCHANGE_RATE_API_KEY || "").trim();
  const requestUrl = apiKey
    ? `${providerBaseUrl}/${encodeURIComponent(apiKey)}/pair/USD/ETB`
    : providerOpenUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let response;

  try {
    response = await fetch(
      requestUrl,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new PublicError(
        "The exchange-rate provider did not respond in time. Please try again.",
        503,
        "exchange_rate_timeout",
      );
    }
    throw new PublicError(
      "The exchange rate is temporarily unavailable. Please try again.",
      503,
      "exchange_rate_unavailable",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    if (apiKey) {
      throw new ConfigurationError(
        "The exchange-rate provider rejected the server configuration.",
      );
    }
    throw new PublicError(
      "The exchange-rate provider is temporarily unavailable. Please try again.",
      503,
      "exchange_rate_unavailable",
    );
  }

  const data = await response.json();
  const etbPerUsd = Number(data.conversion_rate || data.rates?.ETB);
  if (data.result !== "success" || !Number.isFinite(etbPerUsd) || etbPerUsd <= 0) {
    throw new PublicError(
      "The exchange-rate provider did not return a usable ETB/USD rate.",
      503,
      "exchange_rate_unavailable",
    );
  }

  const rateTimestamp = Number(data.time_last_update_unix) * 1000;
  const exchangeRateDate = Number.isFinite(rateTimestamp)
    ? new Date(rateTimestamp).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  return {
    totalEtb: roundCurrency(amountEtb),
    totalUsd: roundCurrency(amountEtb / etbPerUsd),
    etbPerUsd,
    exchangeRateDate,
    provider: apiKey
      ? "ExchangeRate-API"
      : "ExchangeRate-API Open Access",
  };
}
