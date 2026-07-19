import { samsarClient } from "../../../lib/samsar-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsedLimit = Number.parseInt(url.searchParams.get("limit") || "24", 10);
  const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 24, 1), 200);
  const cursor = url.searchParams.get("cursor")?.trim() || undefined;

  try {
    const result = await samsarClient.listInteractivePublications({ limit, cursor });
    return Response.json(result.data, {
      status: result.status,
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Unable to load interactive publications", error);
    return Response.json(
      { error: "Unable to load interactive publications." },
      { status: 502 },
    );
  }
}
