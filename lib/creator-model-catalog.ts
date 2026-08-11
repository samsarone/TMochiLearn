import {
  createCreatorModelCatalog,
  type CreatorModelCatalog,
} from "./creator-config";
import { SAMSAR_API_BASE_URL } from "./samsar-client";

export const CREATOR_MODEL_CATALOG_ERROR =
  "Branched generation model options are temporarily unavailable. Refresh the page to try again.";

function isCreatorModelCatalogPayload(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.INFERENCE_MODELS) &&
    Array.isArray(record.IMAGE_MODELS) &&
    Array.isArray(record.VIDEO_MODELS)
  );
}

export async function getCreatorModelCatalog(): Promise<CreatorModelCatalog> {
  const endpoint = `${SAMSAR_API_BASE_URL.replace(/\/+$/, "")}/video/supported_models`;
  const response = await fetch(endpoint, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Samsar Express model catalog returned HTTP ${response.status}.`);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!isCreatorModelCatalogPayload(payload)) {
    throw new Error("Samsar Express model catalog returned an invalid response.");
  }
  // Empty filtered lists are valid in standalone when the deployment owner has
  // not configured a compatible provider for one or more pipeline stages.
  return createCreatorModelCatalog(payload);
}

export async function loadCreatorModelCatalog(): Promise<{
  catalog: CreatorModelCatalog;
  error: string | null;
}> {
  try {
    return { catalog: await getCreatorModelCatalog(), error: null };
  } catch (error) {
    console.error("[tmochi_creator] unable to load Express model catalog", error);
    return {
      catalog: {
        inferenceModels: [],
        imageModels: [],
        videoModels: [],
        deploymentEdition: "production",
      },
      error: CREATOR_MODEL_CATALOG_ERROR,
    };
  }
}
