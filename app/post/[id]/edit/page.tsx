import RequireAuth from "@/components/auth/RequireAuth";
import EditPostForm from "@/components/post/EditPostForm";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireAuth>
      <EditPostForm postId={Number(id)} />
    </RequireAuth>
  );
}
