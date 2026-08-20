"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getOrCreateConversation } from "@/lib/messages";
import { searchProfiles, type Profile } from "@/lib/profiles";

const SEARCH_DEBOUNCE_MS = 250;

/** Profile -> Message is the other entry point (see PublicProfile.tsx); this
 *  is the Messages-home "New message" entry point — search existing users by
 *  display name, then open (or create) the one conversation with whoever is
 *  selected, via the exact same getOrCreateConversation everything else uses. */
export default function NewMessageScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [openingUserId, setOpeningUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const trimmed = query.trim();
    let cancelled = false;

    const timer = setTimeout(() => {
      if (trimmed.length === 0) {
        if (!cancelled) {
          setResults([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      searchProfiles(trimmed, user.id).then((result) => {
        if (!cancelled) {
          setResults(result);
          setLoading(false);
        }
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, user]);

  async function handleSelect(otherUserId: string) {
    if (openingUserId) return;

    setError(null);
    setOpeningUserId(otherUserId);
    try {
      const conversationId = await getOrCreateConversation(otherUserId);
      router.replace(`/messages/${conversationId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start that conversation.");
      setOpeningUserId(null);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-stone-100 bg-[#fbfaf7]/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Go back"
          className="grid size-9 shrink-0 place-items-center rounded-full text-2xl leading-none text-stone-700"
        >
          ‹
        </button>
        <h1 className="text-base font-black text-stone-900">New message</h1>
      </div>

      <div className="px-4 pt-4">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name"
          aria-label="Search by name"
          autoFocus
          className="w-full rounded-full border border-stone-200 bg-white px-4 py-2.5 text-[16px] text-stone-900 outline-none placeholder:text-stone-400 md:text-sm"
        />
      </div>

      {error ? <p className="px-4 pt-3 text-center text-xs font-semibold text-red-600">{error}</p> : null}

      <div className="mt-2">
        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-stone-400">Searching…</p>
        ) : query.trim().length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-stone-400">Search for someone to message.</p>
        ) : results.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-stone-400">No users found.</p>
        ) : (
          results.map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => handleSelect(profile.id)}
              disabled={openingUserId !== null}
              className="flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-60"
            >
              {profile.avatarUrl ? (
                <DemoPhoto src={profile.avatarUrl} alt="" className="size-11 shrink-0 rounded-full" />
              ) : (
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-stone-200 text-base font-black text-stone-600">
                  {(profile.displayName ?? "?").charAt(0).toUpperCase()}
                </span>
              )}
              <span className="text-sm font-bold text-stone-900">{profile.displayName}</span>
              {openingUserId === profile.id ? <span className="ml-auto text-xs text-stone-400">Opening…</span> : null}
            </button>
          ))
        )}
      </div>
    </main>
  );
}
