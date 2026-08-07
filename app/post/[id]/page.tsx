import PostDetail from "@/components/PostDetail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostDetail postId={Number(id)} />;
}
