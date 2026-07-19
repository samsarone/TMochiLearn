import { toCreatorUser } from "../../../../lib/samsar-auth";
import {
  authenticatedPayload,
  samsarProcessorOrigin,
  sharedAuthCookieHeader,
  upstreamErrorMessage,
} from "../../../../lib/server-auth";

export const dynamic = "force-dynamic";

function buildUsernameFromEmail(email: string) {
  const localPart = email.split("@")[0] || "user";
  const normalized = localPart
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);

  return normalized || `user_${Date.now().toString(36)}`;
}

function normalizedOptionalString(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  return lower === "undefined" || lower === "null" ? null : normalized;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Enter your email and password." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const payload = body && typeof body === "object"
    ? body as Record<string, unknown>
    : {};
  const email = normalizedOptionalString(payload.email)?.toLowerCase() || "";
  const password = typeof payload.password === "string" ? payload.password : "";
  const username =
    normalizedOptionalString(payload.username) || buildUsernameFromEmail(email);

  if (!email || !password) {
    return Response.json(
      { error: "Email and password are required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const preferredLanguage =
    normalizedOptionalString(payload.preferredLanguage) || "en";
  const subscribeToWeeklyNewsletter = payload.subscribeToWeeklyNewsletter === true;

  try {
    const upstream = await fetch(`${samsarProcessorOrigin()}/users/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email,
        password,
        username,
        preferredLanguage,
        subscribeToWeeklyNewsletter,
      }),
    });
    const responseBody: unknown = await upstream.json().catch(() => null);
    const { authToken, profile } = authenticatedPayload(responseBody);
    if (!upstream.ok || !authToken || !profile) {
      const status = upstream.ok
        ? 502
        : upstream.status >= 400 && upstream.status < 500
          ? upstream.status
          : 502;
      return Response.json(
        {
          error: upstreamErrorMessage(
            responseBody,
            upstream.ok
              ? "Samsar registration did not return a valid session."
              : "Unable to create this account.",
          ),
        },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    }

    const cookie = sharedAuthCookieHeader(authToken, request);
    return Response.json(
      { authToken, user: toCreatorUser(profile) },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          ...(cookie ? { "Set-Cookie": cookie } : {}),
        },
      },
    );
  } catch (error) {
    console.error("Unable to register with Samsar", error);
    return Response.json(
      { error: "Samsar registration is temporarily unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
