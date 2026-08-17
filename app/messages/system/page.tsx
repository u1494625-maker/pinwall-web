import RequireAuth from "@/components/auth/RequireAuth";
import SystemMessageScreen from "@/components/messages/SystemMessageScreen";

export default function Page() {
  return (
    <RequireAuth>
      <SystemMessageScreen />
    </RequireAuth>
  );
}
