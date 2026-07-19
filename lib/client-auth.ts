const AUTH_TOKEN_KEY = "authToken";
const AUTH_COOKIE_NAME = "authToken";
const AUTH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function sanitizeToken(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (!token || token.toLowerCase() === "undefined" || token.toLowerCase() === "null") {
    return null;
  }
  return token;
}

function writeTokenToStorage(token: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    return;
  } catch {
    // Session storage is a best-effort fallback for private browsing modes.
  }

  try {
    window.sessionStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    // The shared cookie still keeps the browser session usable.
  }
}

export function getAuthCookieToken() {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${AUTH_COOKIE_NAME}=([^;]+)`),
  );
  if (!match) return null;
  try {
    return sanitizeToken(decodeURIComponent(match[1]));
  } catch {
    return sanitizeToken(match[1]);
  }
}

function setAuthCookie(token: string) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const hostname = window.location.hostname;
  const attributes = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (window.location.protocol === "https:") attributes.push("Secure");
  if (hostname === "samsar.one" || hostname.endsWith(".samsar.one")) {
    attributes.push("Domain=.samsar.one");
  }
  document.cookie = attributes.join("; ");
}

function expireAuthCookie(domain?: string) {
  if (typeof document === "undefined") return;
  const attributes = [
    `${AUTH_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (domain) attributes.push(`Domain=${domain}`);
  document.cookie = attributes.join("; ");
}

export function getExistingAuthToken() {
  if (typeof window === "undefined") return null;

  try {
    const stored = sanitizeToken(window.localStorage.getItem(AUTH_TOKEN_KEY));
    if (stored) return stored;
  } catch {
    // Continue through the compatible fallback chain.
  }

  try {
    const sessionToken = sanitizeToken(window.sessionStorage.getItem(AUTH_TOKEN_KEY));
    if (sessionToken) {
      writeTokenToStorage(sessionToken);
      return sessionToken;
    }
  } catch {
    // Continue to the shared cookie.
  }

  const cookieToken = getAuthCookieToken();
  if (cookieToken) writeTokenToStorage(cookieToken);
  return cookieToken;
}

export function cacheSharedCookieToken() {
  const cookieToken = getAuthCookieToken();
  if (cookieToken) writeTokenToStorage(cookieToken);
  return cookieToken;
}

export function persistAuthToken(value: string) {
  const token = sanitizeToken(value);
  if (!token) return false;
  writeTokenToStorage(token);
  setAuthCookie(token);
  return true;
}

export function clearAuthData() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // Ignore storage access failures while signing out.
  }
  try {
    window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // Ignore storage access failures while signing out.
  }

  expireAuthCookie();
  const hostname = window.location.hostname;
  if (hostname) expireAuthCookie(hostname);
  if (hostname === "samsar.one" || hostname.endsWith(".samsar.one")) {
    expireAuthCookie(".samsar.one");
  }
}

export function broadcastAuthEvent(event: "oauth_complete" | "logout") {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
  const channel = new BroadcastChannel("oauth_channel");
  channel.postMessage(event);
  channel.close();
}
