"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import RequireAuth from "@/components/auth/RequireAuth";
import MediaPostEditor from "@/components/add/MediaPostEditor";

function MediaPostRoute() {
  const searchParams = useSearchParams();
  const source = searchParams.get("source");
  const initialSource = source === "album" || source === "camera" ? source : null;

  return <MediaPostEditor initialSource={initialSource} />;
}

export default function AddMediaPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<main className="min-h-screen bg-[#fbfaf7]" />}>
        <MediaPostRoute />
      </Suspense>
    </RequireAuth>
  );
}
