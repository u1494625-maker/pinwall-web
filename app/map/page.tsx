import { Suspense } from "react";
import MapPage from "@/components/map/MapPage";

export default function Page() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#fbfaf7]" />}>
      <MapPage />
    </Suspense>
  );
}
