import RequireAuth from "@/components/auth/RequireAuth";
import FollowersListPage from "@/components/profile/FollowersListPage";

export default function Page() {
  return (
    <RequireAuth>
      <FollowersListPage />
    </RequireAuth>
  );
}
