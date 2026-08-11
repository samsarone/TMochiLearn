import type {
  ExternalNarrativeInferenceModel,
  ExternalNarrativeVideoModel,
  TextToInteractiveVideoImageModel,
} from "samsar-js";
import {
  CREATOR_MODEL_CATALOG_ERROR,
  getCreatorModelCatalog,
} from "../../../../lib/creator-model-catalog";
import {
  inferCreatorInferenceEffort,
  normalizeCreatorInferenceEffort,
  normalizeCreatorInferenceModel,
} from "../../../../lib/creator-config";
import {
  getAuthenticatedSamsarClient,
  samsarErrorResponse,
  unauthorizedResponse,
} from "../../../../lib/samsar-auth";
import { createCompatibleTextToInteractiveVideo } from "../../../../lib/samsar-client";

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
  const rawInferenceModel = stringValue(body.inference_model ?? body.inferenceModel);
  const inferenceModel = normalizeCreatorInferenceModel(
    rawInferenceModel,
  ) as ExternalNarrativeInferenceModel;
  const rawInferenceEffort = body.effort ?? body.reasoning_effort ?? body.reasoningEffort;
  const explicitInferenceEffort = normalizeCreatorInferenceEffort(rawInferenceEffort);
  const inferenceEffort = inferCreatorInferenceEffort(
    rawInferenceModel,
    explicitInferenceEffort,
  );
  const imageModel = stringValue(body.image_model ?? body.imageModel) as TextToInteractiveVideoImageModel;
  const videoModel = stringValue(body.video_model ?? body.videoModel) as ExternalNarrativeVideoModel;
  const clientRequestId = stringValue(body.client_request_id ?? body.clientRequestId);
  const draftSessionId = stringValue(body.draft_session_id ?? body.draftSessionId).slice(0, 200);

  let modelCatalog;
  try {
    modelCatalog = await getCreatorModelCatalog();
  } catch (error) {
    console.error("[tmochi_creator] unable to validate Express model catalog", error);
    return Response.json(
      { error: CREATOR_MODEL_CATALOG_ERROR },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!prompt || prompt.length > 4000) {
    return Response.json(
      { error: prompt ? "Story direction cannot exceed 4,000 characters." : "Describe the story you want to create." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!Number.isFinite(duration) || duration < 30 || duration > 180) {
    return Response.json(
      { error: "Duration must be between 30 and 180 seconds." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!Number.isInteger(numLevels) || numLevels < 1 || numLevels > 3) {
    return Response.json(
      { error: "TMochiLearn supports one to three branching levels." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (rawInferenceEffort !== undefined && !explicitInferenceEffort) {
    return Response.json(
      { error: "Inference effort must be high or xhigh." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!modelCatalog.inferenceModels.some((model) => model.value === inferenceModel)) {
    return Response.json(
      { error: "Choose a supported branched inference model." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!modelCatalog.imageModels.some((model) => model.value === imageModel)) {
    return Response.json(
      { error: "Choose a supported branched image model." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!modelCatalog.videoModels.some((model) => model.value === videoModel)) {
    return Response.json(
      { error: "Choose a supported branched video model." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    if (draftSessionId) {
      const current = await authenticated.client.getV2StatusDetailed(draftSessionId);
      const currentStatus = String(current.data?.status || "").trim().toUpperCase();
      if (currentStatus !== "INIT" && currentStatus !== "DRAFT") {
        return Response.json(
          { error: "This session has already been submitted and cannot be submitted again." },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    const generationInput = {
      prompt,
      duration,
      inference_model: inferenceModel,
      ...(inferenceModel === "gpt-5.6-sol" ? { effort: inferenceEffort } : {}),
      image_model: imageModel,
      video_model: videoModel,
      num_levels: numLevels,
    };
    const requestOptions = clientRequestId
      ? { idempotencyKey: clientRequestId.slice(0, 200) }
      : undefined;
    console.info("[tmochi_creator] submitting interactive video", {
      draftSessionId: draftSessionId || null,
      numLevels,
      inferenceModel,
      inferenceEffort,
      imageModel,
      videoModel,
    });
    const result = await createCompatibleTextToInteractiveVideo(
      authenticated.client,
      {
        ...generationInput,
        ...(draftSessionId ? { session_id: draftSessionId } : {}),
      },
      requestOptions,
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
