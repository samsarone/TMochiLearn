import type { Metadata } from "next";
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
  return user ? <CreatorStudio initialUser={user} /> : <CreatorLogin redirectPath="/creator" />;
}
