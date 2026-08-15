import RequireAuth from "@/components/auth/RequireAuth";
import FollowersPage from "@/components/messages/FollowersPage";

export default function Page() {
  return (
    <RequireAuth>
      <FollowersPage />
    </RequireAuth>
  );
}
