import TagFeedPage from "@/components/TagFeedPage";

export default async function Page({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  return <TagFeedPage tag={tag} />;
}
