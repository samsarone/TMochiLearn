import SamsarClient, { SamsarRequestError } from "samsar-js";
import type {
  SamsarClientOptions,
  SamsarResult,
  TextToInteractiveVideoCreateResponse,
} from "samsar-js";

export const SAMSAR_API_BASE_URL =
  process.env.SAMSAR_API_BASE_URL || "https://api.samsar.one/v1";

type AuthTokenClientOptions = SamsarClientOptions & { authToken?: string };

type TextToInteractiveVideoRequestOptions = Parameters<
  SamsarClient["createV2TextToInteractiveVideo"]
>[1];

export type CompatibleTextToInteractiveVideoInput = {
  prompt: string;
  duration: number;
  inference_model: string;
  effort?: "high" | "xhigh";
  image_model: string;
  video_model: string;
  num_levels: number;
  session_id?: string;
};

const LEGACY_INTERACTIVE_MODEL_VALIDATION_ERROR =
  /^(?:inference_model|image_model|video_model) must be one of: .* for createTextToInteractiveVideo$/;

export function isLegacyInteractiveModelValidationError(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error instanceof SamsarRequestError || error.name === "SamsarRequestError") return false;
  return LEGACY_INTERACTIVE_MODEL_VALIDATION_ERROR.test(error.message);
}

export function createSamsarClient(authToken?: string) {
  const options: AuthTokenClientOptions = {
    authToken,
    baseUrl: SAMSAR_API_BASE_URL,
    // Keeps this app compatible with samsar-js 0.48.47 deployments while the
    // explicit authToken constructor option rolls out. Newer SDKs create this
    // same Bearer header from authToken directly.
    defaultHeaders: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
    // Cloudflare requires platform functions to retain their invocation context.
    fetch: (input, init) => fetch(input, init),
  };
  return new SamsarClient(options);
}

/**
 * Use the typed helper when the installed SDK recognizes every selected model.
 * Older published SDKs reject newly catalogued branched models before making a
 * request; in that one case, use the same client's low-level v2 transport so
 * authentication, idempotency, response parsing, and SamsarRequestError
 * behavior remain identical.
 */
export async function createCompatibleTextToInteractiveVideo(
  client: SamsarClient,
  input: CompatibleTextToInteractiveVideoInput,
  options?: TextToInteractiveVideoRequestOptions,
): Promise<SamsarResult<TextToInteractiveVideoCreateResponse>> {
  try {
    return await client.createV2TextToInteractiveVideo(
      input as Parameters<SamsarClient["createV2TextToInteractiveVideo"]>[0],
      options,
    );
  } catch (error) {
    if (!isLegacyInteractiveModelValidationError(error)) throw error;
    return client.postV2<TextToInteractiveVideoCreateResponse>(
      "text_to_interactive_video",
      {
        input,
        ...(options?.webhookUrl ? { webhookUrl: options.webhookUrl } : {}),
      },
      options,
    );
  }
}

export const samsarClient = createSamsarClient();
