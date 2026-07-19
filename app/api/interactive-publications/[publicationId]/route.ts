import { SamsarRequestError } from "samsar-js";
import { samsarClient } from "../../../../lib/samsar-client";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ publicationId: string }> },
) {
  const { publicationId } = await context.params;

  try {
    const result = await samsarClient.getInteractivePublication(publicationId);
    return Response.json(result.data, {
      status: result.status,
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    const notFound = error instanceof SamsarRequestError && error.status === 404;
    if (!notFound) console.error("Unable to load interactive publication", error);
    return Response.json(
      { error: notFound ? "Interactive publication not found." : "Unable to load interactive publication." },
      { status: notFound ? 404 : 502 },
    );
  }
}
