import RequireAuth from "@/components/auth/RequireAuth";
import FollowingListPage from "@/components/profile/FollowingListPage";

export default function Page() {
  return (
    <RequireAuth>
      <FollowingListPage />
    </RequireAuth>
  );
}
