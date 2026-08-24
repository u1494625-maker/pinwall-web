import ClusterPostFeedPage from "@/components/map/ClusterPostFeedPage";

type SearchParams = { [key: string]: string | string[] | undefined };

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({
  searchParams,
}: {
  params: Promise<{ clusterId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await searchParams;

  const postIds = (firstValue(resolvedSearchParams.postIds) ?? "")
    .split(",")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  return <ClusterPostFeedPage postIds={postIds} />;
}
