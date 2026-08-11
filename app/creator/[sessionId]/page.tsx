import type { Metadata } from "next";
import { loadCreatorModelCatalog } from "../../../lib/creator-model-catalog";
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

  if (!user) return <CreatorLogin redirectPath={redirectPath} />;

  const { catalog, error } = await loadCreatorModelCatalog();

  return (
    <CreatorStudio
      initialUser={user}
      initialSessionId={normalizedSessionId}
      initialDraft={draft === "1"}
      initialInferenceModels={catalog.inferenceModels}
      initialImageModels={catalog.imageModels}
      initialVideoModels={catalog.videoModels}
      deploymentEdition={catalog.deploymentEdition}
      initialModelCatalogError={error}
    />
  );
}
