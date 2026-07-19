import { toCreatorUser } from "../../../../lib/samsar-auth";
import {
  authenticatedPayload,
  samsarProcessorOrigin,
  sharedAuthCookieHeader,
  upstreamErrorMessage,
} from "../../../../lib/server-auth";

export const dynamic = "force-dynamic";

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
  const email = typeof payload.email === "string"
    ? payload.email.trim().toLowerCase()
    : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!email || !password) {
    return Response.json(
      { error: "Email and password are required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const upstream = await fetch(`${samsarProcessorOrigin()}/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
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
              ? "Samsar sign-in did not return a valid session."
              : "Email or password is incorrect.",
          ),
        },
        {
          status,
          headers: { "Cache-Control": "no-store" },
        },
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
    console.error("Unable to sign in to Samsar", error);
    return Response.json(
      { error: "Samsar sign-in is temporarily unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
