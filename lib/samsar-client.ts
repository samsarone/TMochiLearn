import SamsarClient from "samsar-js";
import type { SamsarClientOptions } from "samsar-js";

export const SAMSAR_API_BASE_URL =
  process.env.SAMSAR_API_BASE_URL || "https://api.samsar.one/v1";

type AuthTokenClientOptions = SamsarClientOptions & { authToken?: string };

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

export const samsarClient = createSamsarClient();
