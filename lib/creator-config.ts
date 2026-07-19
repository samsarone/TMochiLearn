import type {
  ExternalNarrativeVideoModel,
  TextToInteractiveVideoImageModel,
} from "samsar-js";

export const CREATOR_COOKIE_NAME = "authToken";
export const CREATOR_REQUEST_STORAGE_KEY = "tmochi.creator.state.v2";
export const SAMSAR_BILLING_URL = "https://app.samsar.one/account/billing";

export const IMAGE_MODELS: ReadonlyArray<{
  value: TextToInteractiveVideoImageModel;
  label: string;
  detail: string;
}> = [
  { value: "NANOBANANA2", label: "Nano Banana 2", detail: "Balanced cinematic detail" },
  { value: "GPTIMAGE2", label: "GPT Image 2", detail: "Strong prompt fidelity" },
  { value: "NANOBANANAPRO", label: "Nano Banana Pro", detail: "High-detail compositions" },
  { value: "SEEDREAM", label: "Seedream", detail: "Stylized visual direction" },
  { value: "WAN2.7PRO", label: "Wan 2.7 Pro", detail: "Expressive scene design" },
] as const;

export const VIDEO_MODELS: ReadonlyArray<{
  value: ExternalNarrativeVideoModel;
  label: string;
  detail: string;
  creditsPerSecond: number;
}> = [
  { value: "COSMOS3SUPERI2V", label: "Nvidia Cosmos 3", detail: "Efficient · cinematic", creditsPerSecond: 20 },
  { value: "RUNWAYML", label: "Runway Gen-4.5", detail: "Versatile · default", creditsPerSecond: 30 },
  { value: "SEEDANCEI2V", label: "Seedance 1.5", detail: "Fluid motion", creditsPerSecond: 30 },
  { value: "VEO3.1I2VFAST", label: "Veo 3.1 Fast", detail: "Fast · high fidelity", creditsPerSecond: 36 },
  { value: "KLINGIMGTOVID3PRO", label: "Kling 3 Pro", detail: "Detailed motion", creditsPerSecond: 36 },
  { value: "KLINGIMGTOVIDTURBO", label: "Kling Turbo", detail: "Fast detailed motion", creditsPerSecond: 36 },
  { value: "HAPPYHORSEI2V", label: "Happy Horse 1.1", detail: "Expressive movement", creditsPerSecond: 36 },
  { value: "VEO3.1I2V", label: "Veo 3.1", detail: "Premium fidelity", creditsPerSecond: 60 },
] as const;

export function estimateInteractiveCredits(
  duration: number,
  levels: number,
  videoModel: ExternalNarrativeVideoModel,
) {
  const creditsPerSecond =
    VIDEO_MODELS.find((model) => model.value === videoModel)?.creditsPerSecond ?? 30;
  const normalizedDuration = Math.min(240, Math.max(10, Number(duration) || 10));
  const normalizedLevels = Math.min(3, Math.max(1, Math.round(Number(levels) || 1)));

  // Before the narrative exists, divergence points are unknown. This is the
  // conservative ceiling where every final path spans the requested duration.
  return Math.ceil(
    creditsPerSecond * normalizedDuration * Math.pow(2, normalizedLevels),
  );
}
