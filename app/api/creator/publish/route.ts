import {
  getAuthenticatedSamsarClient,
  samsarErrorResponse,
  unauthorizedResponse,
  verifyAuthenticatedSamsarProfile,
} from "../../../../lib/samsar-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authenticated = await getAuthenticatedSamsarClient();
  if (!authenticated) return unauthorizedResponse();
  const profile = await verifyAuthenticatedSamsarProfile(authenticated);
  if (!profile) return unauthorizedResponse();

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return Response.json(
      { error: "Publication details must be valid JSON." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const sessionId = typeof body.sessionId === "string"
    ? body.sessionId.trim()
    : typeof body.session_id === "string"
      ? body.session_id.trim()
      : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!sessionId) {
    return Response.json(
      { error: "The completed video session could not be identified." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!title || title.length > 160) {
    return Response.json(
      { error: title ? "Title cannot exceed 160 characters." : "Add a title before publishing." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (description.length > 2000) {
    return Response.json(
      { error: "Description cannot exceed 2,000 characters." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await authenticated.client.publishPublication({
      session_id: sessionId,
      title,
      description,
      creator_handle:
        (typeof profile.username === "string" && profile.username.trim()) ||
        (typeof profile.displayName === "string" && profile.displayName.trim()) ||
        "tMochi creator",
    });
    return Response.json(result.data, {
      status: result.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return samsarErrorResponse(error, "Unable to publish this interactive film.");
  }
}
