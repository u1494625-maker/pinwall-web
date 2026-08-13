import PostDetail from "@/components/PostDetail";

type SearchParams = { mediaId?: string | string[] };

function parseMediaId(raw: string | string[] | undefined): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
  return <PostDetail postId={Number(id)} initialMediaId={parseMediaId(resolvedSearchParams.mediaId)} />;
}
