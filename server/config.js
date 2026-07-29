import { ConfigurationError } from "./errors.js";

export function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new ConfigurationError(
      `${name} is not configured on the secure payment server.`,
    );
  }
  return value;
}

export function siteUrl() {
  const value = requiredEnv("SITE_URL").replace(/\/+$/, "");
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError("SITE_URL must be a valid absolute URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new ConfigurationError("SITE_URL must use HTTP or HTTPS.");
  }

  return url.origin;
}
