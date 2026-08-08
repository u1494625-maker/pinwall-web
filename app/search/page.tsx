import { Suspense } from "react";
import SearchScreen from "@/components/SearchScreen";

export default function SearchPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#fbfaf7]" />}>
      <SearchScreen />
    </Suspense>
  );
}
