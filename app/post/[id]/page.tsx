import PostDetail from "@/components/PostDetail";

type SearchParams = { mediaId?: string | string[]; moderate?: string | string[] };

function parseMediaId(raw: string | string[] | undefined): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Explicit moderation-tool marker (?moderate=1) — the ONLY thing that makes
// PostDetail ever attempt the admin fallback fetch (get_post_for_moderation)
// on a not-found post. A plain /post/[id] visit, even by an admin, never
// triggers it — see PostDetail.tsx.
function parseIsModerationView(raw: string | string[] | undefined): boolean {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "1";
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  return (
    <PostDetail
      postId={Number(id)}
      initialMediaId={parseMediaId(resolvedSearchParams.mediaId)}
      isModerationView={parseIsModerationView(resolvedSearchParams.moderate)}
    />
  );
}
