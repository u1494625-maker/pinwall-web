import RequireAuth from "@/components/auth/RequireAuth";
import CommentsPage from "@/components/messages/CommentsPage";

export default function Page() {
  return (
    <RequireAuth>
      <CommentsPage />
    </RequireAuth>
  );
}
