import RequireAuth from "@/components/auth/RequireAuth";
import ConversationScreen from "@/components/messages/ConversationScreen";

export default async function Page({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;

  return (
    <RequireAuth>
      <ConversationScreen conversationId={Number(conversationId)} />
    </RequireAuth>
  );
}
