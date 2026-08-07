"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import {
  demoRecentSearches,
  demoTrendingSearches,
} from "@/data/demoData";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState([
    ...demoRecentSearches,
  ]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      return;
    }

    setRecentSearches((currentSearches) => [
      trimmedQuery,
      ...currentSearches.filter(
        (search) => search.toLowerCase() !== trimmedQuery.toLowerCase(),
      ),
    ].slice(0, 5));
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
          <form onSubmit={submitSearch} className="flex flex-1 items-center gap-2 rounded-full bg-stone-100 px-4 py-3 focus-within:ring-2 focus-within:ring-orange-300">
            <span aria-hidden="true" className="text-stone-500">⌕</span>
            <label htmlFor="search-input" className="sr-only">Search places</label>
            <input
              id="search-input"
              type="search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search cafés, study spots, food..."
              className="min-w-0 flex-1 bg-transparent text-sm text-stone-900 outline-none placeholder:text-stone-500"
            />
          </form>
        </div>
      </header>

      <section className="px-5 py-7" aria-labelledby="recent-heading">
        <div className="flex items-center justify-between">
          <h1 id="recent-heading" className="text-lg font-black">Recent</h1>
          <button
            type="button"
            onClick={() => setRecentSearches([])}
            className="text-xs font-semibold text-stone-500"
          >
            Clear all
          </button>
        </div>

        {recentSearches.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {recentSearches.map((search) => (
              <button
                key={search}
                type="button"
                onClick={() => setQuery(search)}
                className="rounded-full border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-700"
              >
                {search}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-stone-500">No recent searches.</p>
        )}
      </section>

      <section className="border-t border-stone-200 px-5 py-7" aria-labelledby="trending-heading">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600">Popular now</p>
        <h2 id="trending-heading" className="mt-1 text-lg font-black">Trending searches</h2>

        <ol className="mt-4 divide-y divide-stone-200">
          {demoTrendingSearches.map((search, index) => (
            <li key={search}>
              <button
                type="button"
                onClick={() => setQuery(search)}
                className="flex w-full items-center gap-4 py-4 text-left"
              >
                <span className="w-5 text-sm font-black text-orange-500">{index + 1}</span>
                <span className="flex-1 text-sm font-semibold text-stone-800">{search}</span>
                <span aria-hidden="true" className="text-stone-400">↗</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
