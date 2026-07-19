import type {
  ExternalNarrativeVideoModel,
  TextToInteractiveVideoImageModel,
} from "samsar-js";
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
} from "../../../../lib/creator-config";
import {
  getAuthenticatedSamsarClient,
  samsarErrorResponse,
  unauthorizedResponse,
} from "../../../../lib/samsar-auth";

export const dynamic = "force-dynamic";

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const authenticated = await getAuthenticatedSamsarClient();
  if (!authenticated) return unauthorizedResponse();

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return Response.json(
      { error: "Generation settings must be valid JSON." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const prompt = stringValue(body.prompt);
  const duration = Number(body.duration);
  const numLevels = Number(body.num_levels ?? body.numLevels);
  const imageModel = stringValue(body.image_model ?? body.imageModel) as TextToInteractiveVideoImageModel;
  const videoModel = stringValue(body.video_model ?? body.videoModel) as ExternalNarrativeVideoModel;
  const clientRequestId = stringValue(body.client_request_id ?? body.clientRequestId);

  if (!prompt || prompt.length > 4000) {
    return Response.json(
      { error: prompt ? "Story direction cannot exceed 4,000 characters." : "Describe the story you want to create." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!Number.isFinite(duration) || duration < 10 || duration > 240) {
    return Response.json(
      { error: "Duration must be between 10 and 240 seconds." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!Number.isInteger(numLevels) || numLevels < 1 || numLevels > 3) {
    return Response.json(
      { error: "tMochi supports one to three branching levels." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!IMAGE_MODELS.some((model) => model.value === imageModel)) {
    return Response.json(
      { error: "Choose a supported image model." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!VIDEO_MODELS.some((model) => model.value === videoModel)) {
    return Response.json(
      { error: "Choose a supported video model." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await authenticated.client.createV2TextToInteractiveVideo(
      {
        prompt,
        duration,
        image_model: imageModel,
        video_model: videoModel,
        num_levels: numLevels,
      },
      clientRequestId ? { idempotencyKey: clientRequestId.slice(0, 200) } : undefined,
    );

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
    return samsarErrorResponse(error, "Unable to start interactive video generation.");
  }
}
