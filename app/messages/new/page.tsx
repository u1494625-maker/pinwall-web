import RequireAuth from "@/components/auth/RequireAuth";
import NewMessageScreen from "@/components/messages/NewMessageScreen";

export default function Page() {
  return (
    <RequireAuth>
      <NewMessageScreen />
    </RequireAuth>
  );
}
