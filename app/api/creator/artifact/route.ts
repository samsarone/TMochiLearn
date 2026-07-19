import {
  getAuthenticatedSamsarClient,
  unauthorizedResponse,
  verifyAuthenticatedSamsarProfile,
} from "../../../../lib/samsar-auth";

export const dynamic = "force-dynamic";

const DEFAULT_MEDIA_HOSTS = [
  "static.samsar.one",
  "storage.googleapis.com",
  "dgyheyjs5bch6.cloudfront.net",
  "samsar-resources.s3.us-west-2.amazonaws.com",
];

function allowedMediaHost(hostname: string) {
  const configured = (process.env.SAMSAR_ARTIFACT_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const host = hostname.toLowerCase();
  const exactHosts = [...DEFAULT_MEDIA_HOSTS, ...configured];
  return exactHosts.includes(host);
}

function allowedArtifactUrl(url: URL) {
  return url.protocol === "https:" && allowedMediaHost(url.hostname);
}

async function fetchAllowedArtifact(initialUrl: URL) {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
    const response = await fetch(currentUrl, { redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("Artifact redirect did not include a destination.");
    const nextUrl = new URL(location, currentUrl);
    if (!allowedArtifactUrl(nextUrl)) {
      throw new Error("Artifact redirect left the approved media hosts.");
    }
    currentUrl = nextUrl;
  }
  throw new Error("Artifact returned too many redirects.");
}

export async function GET(request: Request) {
  const authenticated = await getAuthenticatedSamsarClient();
  if (!authenticated) return unauthorizedResponse();
  if (!await verifyAuthenticatedSamsarProfile(authenticated)) return unauthorizedResponse();

  const source = new URL(request.url).searchParams.get("url");
  let artifactUrl: URL;
  try {
    artifactUrl = new URL(source || "");
  } catch {
    return Response.json(
      { error: "A valid artifact URL is required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!allowedArtifactUrl(artifactUrl)) {
    return Response.json(
      { error: "This artifact host is not allowed." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const upstream = await fetchAllowedArtifact(artifactUrl);
    if (!upstream.ok || !upstream.body) {
      return Response.json(
        { error: "An artifact could not be downloaded." },
        { status: upstream.status || 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
    });
    const length = upstream.headers.get("content-length");
    if (length) headers.set("Content-Length", length);
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    console.error("Unable to proxy creator artifact", error);
    return Response.json(
      { error: "An artifact could not be downloaded." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
