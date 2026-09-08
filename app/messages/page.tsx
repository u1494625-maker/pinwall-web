import MessagesHome from "@/components/messages/MessagesHome";

// MessagesHome handles its own auth states inline (loading / signed-out /
// signed-in) instead of being wrapped in RequireAuth — a signed-out visitor
// still sees this page's own shell and BottomNav, with only the protected
// content area replaced by GuestAuthState. See MessagesHome.tsx.
export default function MessagesPage() {
  return <MessagesHome />;
}
