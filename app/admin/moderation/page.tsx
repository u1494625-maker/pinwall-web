import RequireAuth from "@/components/auth/RequireAuth";
import ModerationQueue from "@/components/admin/ModerationQueue";

export default function Page() {
  return (
    <RequireAuth>
      <ModerationQueue />
    </RequireAuth>
  );
}
