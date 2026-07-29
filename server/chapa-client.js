import { ConfigurationError, PublicError } from "./errors.js";
import { requiredEnv } from "./config.js";

const chapaApiBaseUrl = "https://api.chapa.co/v1";
const requestTimeoutMs = 10_000;
const allowedModes = new Set(["test", "live"]);

function chapaMode() {
  const mode = requiredEnv("CHAPA_MODE").toLowerCase();
  if (!allowedModes.has(mode)) {
    throw new ConfigurationError('CHAPA_MODE must be either "test" or "live".');
  }
  return mode;
}

async function parseChapaResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  let data;

  if (contentType.includes("application/json") && text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const providerMessage =
      typeof data?.message === "string" && data.message.length <= 240
        ? data.message
        : "";
    throw new PublicError(
      providerMessage ||
        "Chapa could not process the secure payment request. Please try again.",
      response.status >= 500 ? 503 : 400,
      "chapa_request_failed",
    );
  }

  if (!data || typeof data !== "object") {
    throw new PublicError(
      "Chapa returned an invalid response. Please try again.",
      502,
      "chapa_invalid_response",
    );
  }

  return data;
}

async function chapaRequest(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(`${chapaApiBaseUrl}${path}`, {
      ...options,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${requiredEnv("CHAPA_SECRET_KEY")}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      signal: controller.signal,
    });
    return await parseChapaResponse(response);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new PublicError(
        "Chapa did not respond in time. Please try again.",
        504,
        "chapa_timeout",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function getChapaMode() {
  return chapaMode();
}

export function initializeChapaTransaction(payload) {
  return chapaRequest("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function verifyChapaTransaction(txRef) {
  const reference = String(txRef || "").trim();
  if (!reference) {
    throw new PublicError("A Chapa transaction reference is required.");
  }
  return chapaRequest(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    { method: "GET" },
  );
}
