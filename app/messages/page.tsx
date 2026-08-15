import RequireAuth from "@/components/auth/RequireAuth";
import MessagesHome from "@/components/messages/MessagesHome";

export default function MessagesPage() {
  return (
    <RequireAuth>
      <MessagesHome />
    </RequireAuth>
  );
}
