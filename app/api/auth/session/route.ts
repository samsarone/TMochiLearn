import {
  getSamsarAuthToken,
  toCreatorUser,
  unauthorizedResponse,
} from "../../../../lib/samsar-auth";
import {
  bearerAuthToken,
  samsarProcessorOrigin,
  sanitizeAuthToken,
  sharedAuthCookieHeader,
  upstreamErrorMessage,
  verifiedProfile,
} from "../../../../lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // An explicit Bearer credential wins over the cookie. This lets a client
  // restore the shared cookie from localStorage even when the cookie is stale.
  const bearerToken = bearerAuthToken(request);
  const authToken = bearerToken || sanitizeAuthToken(await getSamsarAuthToken());
  if (!authToken) return unauthorizedResponse();

  try {
    const upstream = await fetch(`${samsarProcessorOrigin()}/users/verify_token`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      cache: "no-store",
    });
    const responseBody: unknown = await upstream.json().catch(() => null);
    const profile = verifiedProfile(responseBody);
    if (!upstream.ok || !profile) {
      if ([400, 401, 403].includes(upstream.status)) {
        return Response.json(
          {
            error: upstreamErrorMessage(
              responseBody,
              "Sign in with your Samsar account to continue.",
            ),
          },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        );
      }

      return Response.json(
        {
          error: upstreamErrorMessage(
            responseBody,
            upstream.ok
              ? "Samsar returned an invalid user session."
              : "Samsar session verification is temporarily unavailable.",
          ),
        },
        {
          status:
            !upstream.ok && upstream.status >= 400 && upstream.status < 500
              ? upstream.status
              : 502,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    const headers = new Headers({ "Cache-Control": "no-store" });
    if (bearerToken) {
      const cookie = sharedAuthCookieHeader(bearerToken, request);
      if (cookie) headers.set("Set-Cookie", cookie);
    }

    return Response.json({ user: toCreatorUser(profile) }, { headers });
  } catch (error) {
    console.error("Unable to verify Samsar session", error);
    return Response.json(
      { error: "Samsar session verification is temporarily unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
