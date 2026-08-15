import RequireAuth from "@/components/auth/RequireAuth";
import LikesPage from "@/components/messages/LikesPage";

export default function Page() {
  return (
    <RequireAuth>
      <LikesPage />
    </RequireAuth>
  );
}
