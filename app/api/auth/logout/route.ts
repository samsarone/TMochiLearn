import { CREATOR_COOKIE_NAME } from "../../../../lib/creator-config";

export const dynamic = "force-dynamic";

function expiredCookie(domain?: string) {
  return [
    `${CREATOR_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "SameSite=Lax",
    ...(domain ? [`Domain=${domain}`] : []),
  ].join("; ");
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const hostname = (forwardedHost || requestUrl.hostname).split(":")[0];
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", expiredCookie());
  if (hostname === "samsar.one" || hostname.endsWith(".samsar.one")) {
    headers.append("Set-Cookie", expiredCookie(".samsar.one"));
  }
  return Response.json({ signedOut: true }, { headers });
}
