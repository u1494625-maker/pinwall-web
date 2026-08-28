"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import MasonryFeed, { FeedSkeleton } from "@/components/MasonryFeed";
import { useAuth } from "@/lib/auth/AuthProvider";
import { searchProfiles, type Profile } from "@/lib/profiles";
import { logSearchQueryEvent } from "@/lib/recommendation/events";
import { searchPosts } from "@/lib/search";
import { useAllPostsState } from "@/lib/posts";

type SearchMode = "posts" | "users";

const SEARCH_MODES: { key: SearchMode; label: string }[] = [
  { key: "posts", label: "Posts" },
  { key: "users", label: "Users" },
];

/** Same underline-tab visual language as CategoryChips (Home's own
 *  Explore/Following/Maps tabs) — kept as separate, local markup rather
 *  than generalizing CategoryChips itself, so Home's own tabs are
 *  untouched by this. */
function SearchModeTabs({ mode, onSelect }: { mode: SearchMode; onSelect: (mode: SearchMode) => void }) {
  return (
    <div className="flex gap-6 px-4 pt-3">
      {SEARCH_MODES.map(({ key, label }) => {
        const isSelected = key === mode;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            aria-pressed={isSelected}
            className={`relative py-1.5 text-[15px] font-bold transition-colors ${
              isSelected ? "text-stone-900" : "text-stone-400"
            }`}
          >
            {label}
            {isSelected ? (
              <span className="absolute inset-x-0 -bottom-1.5 h-[2.5px] rounded-full bg-kavanaka-lime" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Compact profile row — same shape as NewMessageScreen's own result rows
 *  (avatar with initial-letter fallback, display name), but a plain Link to
 *  the profile rather than an async "open a conversation" action. Shows a
 *  truncated bio as a secondary line when the profile has one; there is no
 *  other appropriate secondary identity field on profiles today (no
 *  username, no location). Deliberately carries no Follow/Message/Block
 *  affordance of its own — PublicProfile already owns all of that,
 *  including the correct blocked-state handling. */
function UserResultRow({ profile }: { profile: Profile }) {
  return (
    <Link href={`/profile/${profile.id}`} className="flex w-full items-center gap-3 px-4 py-3 text-left">
      {profile.avatarUrl ? (
        <DemoPhoto src={profile.avatarUrl} alt="" className="size-11 shrink-0 rounded-full" />
      ) : (
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-stone-200 text-base font-black text-stone-600">
          {(profile.displayName ?? "?").charAt(0).toUpperCase()}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold text-stone-900">{profile.displayName}</span>
        {profile.bio ? <span className="block truncate text-xs text-stone-500">{profile.bio}</span> : null}
      </span>
    </Link>
  );
}

export default function SearchScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const q = searchParams.get("q") ?? "";
  const trimmedQuery = q.trim();
  const mode: SearchMode = searchParams.get("mode") === "users" ? "users" : "posts";

  // Seeded from the URL so loading /search?q=... directly pre-fills the
  // input instead of showing a blank box next to populated results.
  const [draft, setDraft] = useState(() => searchParams.get("q") ?? "");

  const { posts, loading: postsLoading } = useAllPostsState();

  const postResults = useMemo(
    () => (trimmedQuery ? searchPosts(posts, trimmedQuery) : []),
    [posts, trimmedQuery],
  );

  const [userResults, setUserResults] = useState<Profile[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  // Only ever fetches while the Users tab is active — switching to it (or
  // changing the query while already on it) is what triggers this, not
  // every keystroke: the query itself only ever changes on submitSearch
  // below, matching Posts' own submit-based (not live-filter) behavior, so
  // there's nothing to debounce here. No reset is needed for the empty-query
  // case: the render below already gates results on `trimmedQuery` itself,
  // so a stale userResults value is never actually shown, and the only way
  // trimmedQuery genuinely becomes empty is a fresh navigation to a
  // paramless /search, which remounts this whole component anyway.
  useEffect(() => {
    if (mode !== "users" || !trimmedQuery) return;
    let cancelled = false;

    async function load() {
      setUsersLoading(true);
      const result = await searchProfiles(trimmedQuery, user?.id);
      if (cancelled) return;
      setUserResults(result);
      setUsersLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [mode, trimmedQuery, user]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;

    // Fire-and-forget, signed-in only — never awaited, so a slow/failed
    // insert can never delay navigation. Logged on every explicit submit
    // regardless of which tab is active, matching this event's existing,
    // unchanged meaning ("a search was made") rather than narrowing it to
    // Posts specifically.
    if (user) {
      logSearchQueryEvent(user.id, next);
    }

    // replace (not push) so repeated searches update one history entry
    // instead of stacking; carries the current mode forward so switching to
    // Users, then searching something new, doesn't silently snap back to
    // Posts.
    const params = new URLSearchParams({ q: next });
    if (mode === "users") params.set("mode", "users");
    router.replace(`/search?${params.toString()}`);
  }

  function switchMode(nextMode: SearchMode) {
    // Preserves q (and everything else already in the URL) untouched —
    // this never re-submits or clears the query, just changes which
    // results are shown for it.
    const params = new URLSearchParams(searchParams.toString());
    if (nextMode === "users") params.set("mode", "users");
    else params.delete("mode");
    router.replace(`/search?${params.toString()}`);
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-10 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-[#fbfaf7]/95 pb-1 pt-[calc(env(safe-area-inset-top)+1rem)] backdrop-blur">
        <div className="flex items-center gap-3 px-4 pb-3">
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
            <label htmlFor="search-input" className="sr-only">Search Kavanaka</label>
            <input
              id="search-input"
              type="search"
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search Kavanaka"
              className="min-w-0 flex-1 bg-transparent text-[16px] text-stone-900 outline-none placeholder:text-stone-500 md:text-sm"
            />
          </form>
        </div>
        <SearchModeTabs mode={mode} onSelect={switchMode} />
      </header>

      {!trimmedQuery ? null : mode === "posts" ? (
        postsLoading ? (
          <FeedSkeleton />
        ) : postResults.length === 0 ? (
          <div className="mx-4 mt-6 rounded-3xl border border-dashed border-stone-300 bg-white px-6 py-14 text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-kavanaka-lime/15 text-2xl">⌕</div>
            <h2 className="text-lg font-bold">No results for &ldquo;{trimmedQuery}&rdquo;</h2>
            <p className="mt-2 text-sm text-stone-500">Try different keywords.</p>
          </div>
        ) : (
          <MasonryFeed posts={postResults} />
        )
      ) : usersLoading ? (
        <p className="px-4 py-14 text-center text-sm text-stone-400">Searching…</p>
      ) : userResults.length === 0 ? (
        <p className="px-4 py-14 text-center text-sm text-stone-400">No users found.</p>
      ) : (
        <div className="mt-1">
          {userResults.map((profile) => (
            <UserResultRow key={profile.id} profile={profile} />
          ))}
        </div>
      )}
    </main>
  );
}
