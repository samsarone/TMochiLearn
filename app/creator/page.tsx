import type { Metadata } from "next";
import { loadCreatorModelCatalog } from "../../lib/creator-model-catalog";
import { verifySamsarUser } from "../../lib/samsar-auth";
import CreatorLogin from "./creator-login";
import CreatorStudio from "./creator-studio";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Creator Studio — TMochiLearn",
  description: "Create, preview, and publish interactive educational, technical, and training videos with TMochiLearn.",
};

export default async function CreatorPage() {
  const user = await verifySamsarUser();
  if (!user) return <CreatorLogin redirectPath="/creator" />;

  const { catalog, error } = await loadCreatorModelCatalog();
  return (
    <CreatorStudio
      initialUser={user}
      initialInferenceModels={catalog.inferenceModels}
      initialImageModels={catalog.imageModels}
      initialVideoModels={catalog.videoModels}
      deploymentEdition={catalog.deploymentEdition}
      initialModelCatalogError={error}
    />
  );
}
