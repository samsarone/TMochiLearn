import type { Metadata } from "next";
import { verifySamsarUser } from "../../../lib/samsar-auth";
import CreatorLogin from "../creator-login";
import CreatorStudio from "../creator-studio";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Creator Session — tMochi",
  description: "Resume and preview a tMochi interactive film generation.",
};

export default async function CreatorSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const normalizedSessionId = sessionId.trim().slice(0, 200);
  const redirectPath = `/creator/${encodeURIComponent(normalizedSessionId)}`;
  const user = await verifySamsarUser();

  return user ? (
    <CreatorStudio initialUser={user} initialSessionId={normalizedSessionId} />
  ) : (
    <CreatorLogin redirectPath={redirectPath} />
  );
}
