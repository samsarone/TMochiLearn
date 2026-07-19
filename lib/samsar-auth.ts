import { cookies } from "next/headers";
import { SamsarRequestError } from "samsar-js";
import type {
  SamsarResult,
  VerifiedClientSessionResponse,
} from "samsar-js";
import { CREATOR_COOKIE_NAME } from "./creator-config";
import {
  SAMSAR_API_BASE_URL,
  createSamsarClient,
} from "./samsar-client";

export type CreatorUser = {
  id: string | null;
  email: string | null;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  generationCredits: number;
};

function decodeCookieValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function getSamsarAuthToken() {
  const cookieStore = await cookies();
  const value = cookieStore.get(CREATOR_COOKIE_NAME)?.value;
  return value ? decodeCookieValue(value).trim() : null;
}

export async function getAuthenticatedSamsarClient() {
  const authToken = await getSamsarAuthToken();
  return authToken
    ? { authToken, client: createSamsarClient(authToken) }
    : null;
}

export type AuthenticatedSamsarClient = NonNullable<
  Awaited<ReturnType<typeof getAuthenticatedSamsarClient>>
>;

export function toCreatorUser(profile: VerifiedClientSessionResponse): CreatorUser {
  const email = typeof profile.email === "string" ? profile.email : null;
  const username = typeof profile.username === "string" ? profile.username : null;
  const displayName =
    (typeof profile.displayName === "string" && profile.displayName.trim()) ||
    username ||
    email ||
    "Samsar creator";

  return {
    id: typeof profile._id === "string" ? profile._id : null,
    email,
    username,
    displayName,
    avatarUrl:
      typeof profile.avatarUrl === "string"
        ? profile.avatarUrl
        : typeof profile.pfpUrl === "string"
          ? profile.pfpUrl
          : null,
    generationCredits: Number.isFinite(Number(profile.generationCredits))
      ? Number(profile.generationCredits)
      : 0,
  };
}

/**
 * Verify the configured Bearer credential without copying it into a query string.
 * samsar-js versions with native authToken support take the first path. The
 * direct-header fallback keeps deployed 0.48.47 builds safe until that SDK
 * release is available from the registry.
 */
export async function verifyAuthenticatedSamsarProfile(
  authenticated: AuthenticatedSamsarClient,
): Promise<VerifiedClientSessionResponse | null> {
  try {
    const verifyWithConfiguredToken = authenticated.client.verifyClientSession.bind(
      authenticated.client,
    ) as () => Promise<SamsarResult<VerifiedClientSessionResponse>>;
    const result = await verifyWithConfiguredToken();
    return result.data;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "loginToken or authToken is required"
    ) {
      return null;
    }
  }

  try {
    const apiOrigin = new URL(SAMSAR_API_BASE_URL).origin;
    const response = await fetch(`${apiOrigin}/users/verify_token`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${authenticated.authToken}`,
      },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const profile = await response.json().catch(() => null);
    return profile && typeof profile === "object"
      ? profile as VerifiedClientSessionResponse
      : null;
  } catch {
    return null;
  }
}

export async function verifySamsarUser(): Promise<CreatorUser | null> {
  const authenticated = await getAuthenticatedSamsarClient();
  if (!authenticated) return null;

  const profile = await verifyAuthenticatedSamsarProfile(authenticated);
  return profile ? toCreatorUser(profile) : null;
}

export function samsarErrorResponse(error: unknown, fallback: string) {
  if (error instanceof SamsarRequestError) {
    const body = error.body && typeof error.body === "object"
      ? error.body as Record<string, unknown>
      : null;
    const message =
      (typeof body?.message === "string" && body.message) ||
      (typeof body?.error === "string" && body.error) ||
      error.message ||
      fallback;
    return Response.json(
      {
        error: message,
        code: typeof body?.code === "string" ? body.code : undefined,
        creditsRemaining: error.creditsRemaining,
      },
      {
        status: error.status || 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  console.error(fallback, error);
  return Response.json(
    { error: fallback },
    { status: 502, headers: { "Cache-Control": "no-store" } },
  );
}

export function unauthorizedResponse() {
  return Response.json(
    { error: "Sign in with your Samsar account to continue." },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}
