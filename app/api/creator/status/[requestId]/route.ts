import {
  getAuthenticatedSamsarClient,
  samsarErrorResponse,
  unauthorizedResponse,
} from "../../../../../lib/samsar-auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  const authenticated = await getAuthenticatedSamsarClient();
  if (!authenticated) return unauthorizedResponse();
  const { requestId } = await context.params;
  if (!requestId?.trim() || requestId.trim().length > 200) {
    return Response.json(
      { error: "A valid request ID is required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await authenticated.client.getV2StatusDetailed(requestId.trim());
    return Response.json(
      {
        ...result.data,
        ...(typeof result.creditsCharged === "number"
          ? { creditsCharged: result.creditsCharged }
          : {}),
        ...(typeof result.creditsRemaining === "number"
          ? { creditsRemaining: result.creditsRemaining }
          : {}),
      },
      { status: result.status, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return samsarErrorResponse(error, "Unable to retrieve generation status.");
  }
}
