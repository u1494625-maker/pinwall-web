"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import MasonryFeed, { FeedSkeleton } from "@/components/MasonryFeed";
import { useAuth } from "@/lib/auth/AuthProvider";
import { logSearchQueryEvent } from "@/lib/recommendation/events";
import { searchPosts } from "@/lib/search";
import { useAllPostsState } from "@/lib/posts";

export default function SearchScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const q = searchParams.get("q") ?? "";
  const trimmedQuery = q.trim();

  // Seeded from the URL so loading /search?q=... directly pre-fills the
  // input instead of showing a blank box next to populated results.
  const [draft, setDraft] = useState(() => searchParams.get("q") ?? "");

  const { posts, loading: postsLoading } = useAllPostsState();

  const results = useMemo(
    () => (trimmedQuery ? searchPosts(posts, trimmedQuery) : []),
    [posts, trimmedQuery],
  );

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;

    // Fire-and-forget, signed-in only — never awaited, so a slow/failed
    // insert can never delay navigation. Logged on every explicit submit
    // (never on keystrokes), including a repeat of the same query — repeated
    // interest is a real signal, not something to deduplicate away.
    if (user) {
      logSearchQueryEvent(user.id, next);
    }

    // replace (not push) so repeated searches update one history entry
    // instead of stacking; URLSearchParams serializes spaces as "+".
    router.replace(`/search?${new URLSearchParams({ q: next }).toString()}`);
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-10 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-[#fbfaf7]/95 px-4 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            aria-label="Back to Home"
            className="grid size-10 shrink-0 place-items-center rounded-full text-3xl leading-none text-stone-700"
          >
            ‹
          </Link>
          <form
            onSubmit={submitSearch}
            className="flex flex-1 items-center gap-2 rounded-full bg-stone-100 px-4 py-3 focus-within:ring-2 focus-within:ring-kavanaka-lime/60"
          >
            <span aria-hidden="true" className="text-stone-500">⌕</span>
            <label htmlFor="search-input" className="sr-only">Search places</label>
            <input
              id="search-input"
              type="search"
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search cafés, study spots, food..."
              className="min-w-0 flex-1 bg-transparent text-sm text-stone-900 outline-none placeholder:text-stone-500"
            />
          </form>
        </div>
      </header>

      {!trimmedQuery ? (
        <div className="px-6 py-20 text-center">
          <p className="text-sm text-stone-500">Search for cafés, study spots, food, or a friend&apos;s post.</p>
        </div>
      ) : postsLoading ? (
        <FeedSkeleton />
      ) : results.length === 0 ? (
        <div className="mx-4 mt-6 rounded-3xl border border-dashed border-stone-300 bg-white px-6 py-14 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-kavanaka-lime/15 text-2xl">⌕</div>
          <h2 className="text-lg font-bold">No results for &ldquo;{trimmedQuery}&rdquo;</h2>
          <p className="mt-2 text-sm text-stone-500">Try different keywords.</p>
        </div>
      ) : (
        <MasonryFeed posts={results} />
      )}
    </main>
  );
}
