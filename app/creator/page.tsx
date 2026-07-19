import type { Metadata } from "next";
import { verifySamsarUser } from "../../lib/samsar-auth";
import CreatorLogin from "./creator-login";
import CreatorStudio from "./creator-studio";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Creator Studio — tMochi",
  description: "Create, preview, download, and publish branching interactive films with tMochi.",
};

export default async function CreatorPage() {
  const user = await verifySamsarUser();
  return user ? <CreatorStudio initialUser={user} /> : <CreatorLogin redirectPath="/creator" />;
}
