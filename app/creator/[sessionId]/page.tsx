import type { Metadata } from "next";
import { verifySamsarUser } from "../../../lib/samsar-auth";
import CreatorLogin from "../creator-login";
import CreatorStudio from "../creator-studio";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Creator Session — TMochiLearn",
  description: "Resume and preview a TMochiLearn interactive lesson.",
};

export default async function CreatorSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ draft?: string }>;
}) {
  const { sessionId } = await params;
  const { draft } = await searchParams;
  const normalizedSessionId = sessionId.trim().slice(0, 200);
  const redirectPath = `/creator/${encodeURIComponent(normalizedSessionId)}`;
  const user = await verifySamsarUser();

  return user ? (
    <CreatorStudio
      initialUser={user}
      initialSessionId={normalizedSessionId}
      initialDraft={draft === "1"}
    />
  ) : (
    <CreatorLogin redirectPath={redirectPath} />
  );
}
