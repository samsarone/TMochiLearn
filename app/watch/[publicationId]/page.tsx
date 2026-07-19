import Home from "../../page";

export default async function WatchPublicationPage({
  params,
}: {
  params: Promise<{ publicationId: string }>;
}) {
  const { publicationId } = await params;
  return <Home initialPublicationId={publicationId} />;
}
