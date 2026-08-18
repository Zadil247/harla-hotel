const referencePattern = /^HARLA-HALL-\d{4}-\d{4,}$/;
const portalTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const latestAccessKey = "harla-event-request:last";

export function portalStorageKey(reference) {
  return `harla-event-request:${String(reference || "").trim().toUpperCase()}`;
}

export function validPortalAccess(access) {
  return referencePattern.test(String(access?.reference || "").trim().toUpperCase())
    && portalTokenPattern.test(String(access?.token || "").trim());
}

export function portalAccessFromUrl(value) {
  const url = new URL(value);
  const hasReference = url.searchParams.has("reference");
  const hasToken = url.searchParams.has("token");
  return {
    hasSecureParameters: hasReference || hasToken,
    hasReference,
    hasToken,
    reference: String(url.searchParams.get("reference") || "").trim().toUpperCase(),
    token: String(url.searchParams.get("token") || "").trim(),
  };
}

export function sanitizedPortalLocation(value) {
  const url = new URL(value);
  url.searchParams.delete("reference");
  url.searchParams.delete("token");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function rememberPortalAccess(storage, access) {
  if (!validPortalAccess(access)) return false;
  const saved = {
    reference: String(access.reference).trim().toUpperCase(),
    token: String(access.token).trim(),
  };
  storage.setItem(portalStorageKey(saved.reference), saved.token);
  storage.setItem(latestAccessKey, JSON.stringify(saved));
  return true;
}

export function recoverPortalAccess(storage, preferredReference = "") {
  const reference = String(preferredReference || "").trim().toUpperCase();
  if (referencePattern.test(reference)) {
    const preferred = { reference, token: storage.getItem(portalStorageKey(reference)) || "" };
    if (validPortalAccess(preferred)) return preferred;
  }

  try {
    const latest = JSON.parse(storage.getItem(latestAccessKey) || "null");
    if (validPortalAccess(latest)) {
      return {
        reference: String(latest.reference).trim().toUpperCase(),
        token: String(latest.token).trim(),
      };
    }
  } catch {
    // Ignore malformed legacy browser state and show the safe recovery message.
  }
  return null;
}

export function forgetPortalAccess(storage, access) {
  if (!validPortalAccess(access)) return;
  const key = portalStorageKey(access.reference);
  if (storage.getItem(key) === access.token) storage.removeItem(key);

  try {
    const latest = JSON.parse(storage.getItem(latestAccessKey) || "null");
    if (latest?.reference === access.reference && latest?.token === access.token) {
      storage.removeItem(latestAccessKey);
    }
  } catch {
    storage.removeItem(latestAccessKey);
  }
}
