import type { VerifiedClientSessionResponse } from "samsar-js";
import { CREATOR_COOKIE_NAME } from "./creator-config";
import { SAMSAR_API_BASE_URL } from "./samsar-client";

const AUTH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

export function sanitizeAuthToken(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const token = value.trim();
  if (!token) return null;

  const normalized = token.toLowerCase();
  return normalized === "undefined" || normalized === "null" ? null : token;
}

export function bearerAuthToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;

  const match = authorization.match(/^\s*Bearer\s+(.+?)\s*$/i);
  return match ? sanitizeAuthToken(match[1]) : null;
}

function requestHostname(request: Request) {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const rawHost = forwardedHost || new URL(request.url).host;

  try {
    return new URL(`http://${rawHost}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return new URL(request.url).hostname.toLowerCase().replace(/\.$/, "");
  }
}

function requestIsSecure(request: Request) {
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  return forwardedProtocol
    ? forwardedProtocol === "https"
    : new URL(request.url).protocol === "https:";
}

export function sharedAuthCookieHeader(tokenValue: unknown, request: Request) {
  const token = sanitizeAuthToken(tokenValue);
  if (!token) return null;

  const hostname = requestHostname(request);
  const attributes = [
    `${CREATOR_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];

  if (hostname === "samsar.one" || hostname.endsWith(".samsar.one")) {
    attributes.push("Domain=.samsar.one");
  }
  if (requestIsSecure(request)) attributes.push("Secure");

  // Deliberately omit HttpOnly: existing Samsar clients hydrate their
  // origin-scoped localStorage token from this shared browser cookie.
  return attributes.join("; ");
}

export function samsarProcessorOrigin() {
  return new URL(SAMSAR_API_BASE_URL).origin;
}

export function upstreamErrorMessage(payload: unknown, fallback: string) {
  const record = asRecord(payload);
  const data = asRecord(record?.data);

  for (const candidate of [record?.message, record?.error, data?.message, data?.error]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  return fallback;
}

export function authenticatedPayload(payload: unknown): {
  authToken: string | null;
  profile: VerifiedClientSessionResponse | null;
} {
  const record = asRecord(payload);
  if (!record) return { authToken: null, profile: null };

  const data = asRecord(record.data);
  const authToken = sanitizeAuthToken(record.authToken) || sanitizeAuthToken(data?.authToken);
  const profile = asRecord(data?.user) || asRecord(record.user) || data || record;

  return {
    authToken,
    profile: profile as VerifiedClientSessionResponse,
  };
}

export function verifiedProfile(payload: unknown): VerifiedClientSessionResponse | null {
  const record = asRecord(payload);
  if (!record) return null;

  const data = asRecord(record.data);
  const profile = asRecord(data?.user) || asRecord(record.user) || data || record;
  return profile as VerifiedClientSessionResponse;
}
