# Changelog

Dated entries for meaningful completed milestones, newest first. Reconstructed from Git history (`git log`) and the current codebase — entries before this file existed are summarized from commit content, not guessed. Line-level detail lives in Git; this file records what changed and why, not how.

## 2026-08-08 — Owner-only post deletion (Phase 1 of post management)

Post Detail now has a real, owner-only management entry: a subtle "Manage post" row (visible only when the signed-in user's id matches the post's `user_id` — never rendered at all for anyone else) opens a new Pinwall-styled bottom sheet (`components/post/PostManageSheet.tsx`, following the same native-`<dialog>` slide-up pattern as the existing post-creation action sheet). The sheet already shows all three planned rows — Edit and Privacy are visible but disabled, reserving the sheet's final shape — but only Delete is functional in this phase. Deleting requires an explicit confirm step, then removes the post's Storage media (its object path is derived from the stored public URL — no new stored-path column) before deleting the `posts` row, in that order, so a partial failure never orphans a Storage object or silently reports success; a DB-delete failure after a successful media delete can be retried without re-attempting the (already-done) media removal. Required one new Storage RLS policy (`supabase/post_deletion.sql`) — the existing `posts`-table delete policy already covered ownership.

**Deferred**: Edit (title/caption/tags/location) and Privacy (Public/Private, including the `is_private` schema/RLS work and filtering it out of Home/Search/Map for non-owners) are separate, not-yet-started phases — intentionally, so the higher-risk privacy/visibility RLS work gets its own focused pass rather than landing bundled with deletion.

## 2026-08-08 — Smart Search (`eabeda6`)

`/search` went from a fully-demo screen (hardcoded "Recent"/"Trending" text, no real search) to a real client-side keyword search over the already-loaded post list — title, tags, location, caption, author, weighted by how deliberate/curated each field is, with an explicit score-then-recency tie-break. The URL (`/search?q=...`) is the source of truth: the input is a draft synced to it only on submit, so a shared/reloaded search link reproduces the same results and pre-fills the box. Results render through the exact same `MasonryFeed`/`PostCard` Home uses — no separate search-result design — which required extracting the loading skeleton (`FeedSkeleton`) out of `PinWallHome.tsx` into `MasonryFeed.tsx` so both places could share it without duplicating it.

**Deferred**: server-side/Postgres full-text search (would need a schema migration — postponed until client-side "load the whole table" stops scaling), embeddings/semantic/LLM-based search, match highlighting inside `PostCard`, fuzzy/typo-tolerant matching, real (non-fake) recent-search history.

## 2026-08-07 — HEIC/HEIF upload support + posts-loading-state fix (`2b937a0`)

Two independent fixes landed together:
- **HEIC/HEIF photos** (common on iPhones) are now detected at selection time and converted client-side to JPEG *before* preview, aspect-ratio measurement, or upload — browsers other than newer Safari can't reliably decode HEIC, so storing it directly would have produced broken previews for most viewers. Chose `heic-to` (actively maintained) over the more popular but effectively unmaintained `heic2any`, dynamically imported so its ~3MB WASM payload is only ever fetched when a HEIC file is actually selected. HEIC sources get a separate, more generous 15MB size ceiling before conversion (vs. the standard 5MB image limit), since HEIC's compression means a legitimate photo can exceed 5MB pre-conversion; the converted JPEG is retried at descending quality until it fits the real 5MB limit, or publishing fails with a clear error.
- **Loading-state flash fix**: `useAllPosts()` returned a bare `Post[]` starting as `[]`, so every consumer briefly showed a genuine-looking empty/not-found state before the async Supabase fetch resolved (Home's Explore tab flashed "No spots yet," Post Detail flashed "Post not found"). Added `useAllPostsState()` (returns `{ posts, loading }`) as the new API; `useAllPosts()` became a one-line wrapper over it so every other existing consumer (Me, Saved, Map, cluster feed) needed zero changes. Home and Post Detail now show a neutral loading skeleton instead of a premature empty state.

**Deferred**: the same loading-flash class of issue is still latent (unfixed, not regressed) on `/me`, `/saved`, and the cluster feed page — not reported, not touched. Web Worker–based HEIC conversion (to avoid main-thread blocking on large photos) noted as a future option if the ~0.5–3s conversion time proves to be a real problem.

## 2026-08-07 — Composer, Post Detail, and card redesign (`bd47e63`)

The largest single UI milestone: the post composer went from a labeled-form/CMS look (boxed inputs, a giant dashed upload box, a bulky map-toggle card) to a mobile-native editor (compact single-media-slot tile, borderless title/caption fields, a hashtag-style chip tag input, settings-row-style map toggle). Post Detail dropped a Yelp-style hierarchy (a fake rating line, a "Shared by" footer, a location badge that could show literal placeholder-looking test data) in favor of a top author bar before the media, real image aspect ratios instead of a forced crop, and a Comments section that's structurally real but honestly empty (no comments backend exists). `PostCard` was stripped down to media → title → compact author row, with caption/tags/save button all removed — the same simplified card now used identically on Home and (later) Me. Several correction passes are folded into this same commit: the map-location picker no longer requires a place-name field (coordinates alone are enough) and no longer collapses the instant a pin is placed; a shared 40-character title limit was added; publishing now lands on `/me` instead of the just-created post; `BottomNav`'s Me tab shows a plain "Me" label instead of the user's name, matching the other tabs structurally.

**Deferred**: real follow/like/comment backends (every related UI is either omitted or a structurally-ready, honestly-inert placeholder — never faked); multi-image posts (the data model is still one media field per post); a Web Worker or gesture-driven media transition (never started).

## 2026-08-06 — Map ↔ Feed discovery loop (`ff363a2`)

Connected what had been two separate features (a browsing Map and a Home feed) into one system: the Map's last-viewed geographic viewport now persists (`sessionStorage`) and drives a new "Maps" tab on Home, distinct from both "no area selected" and "area selected but genuinely empty" (each with its own honest copy, never the generic feed empty-state). A post's location link now opens the Map centered and highlighted on that exact pin (`?postId=` targeting) without overwriting the user's ambient chosen area, distinguishing a one-off *targeted* camera move from a persisted *ambient* one via a suppress-flag on the viewport-save path. Existing clustering behavior (Supercluster, far-zoom clusters / close-zoom pins, cluster-tap → regional feed) was preserved, not rewritten.

**Deferred**: the gesture-driven pin → circular-preview → full-screen transition concept (explicitly scoped as future/experimental, never implemented).

## 2026-08-06 — Foundational app (`9f6c29f`)

The first working version of Pinwall as a distinct product (as opposed to the bare Next.js scaffold before it): Home feed (masonry + cards), an interactive Map with Supercluster-based clustering and a regional cluster feed, post creation supporting image/video/text posts with an optional map location, Post Detail, Google OAuth via Supabase Auth (`RequireAuth` renders a login screen in place, no redirects), the Me profile page, a fully-demo Messages inbox, a fully-demo Search screen, a localStorage-backed Saved list, and the global bottom navigation. Supabase schema evolved across three files in this era: an initial open-RLS `posts` table, then `user_id` ownership + tightened RLS once Google Sign-In existed, then `post_type` + relaxed `NOT NULL` constraints to support video and text posts alongside image posts.

## 2026-08-05 — Initial commit (`3190497`)

Bare `create-next-app` scaffold — no Pinwall-specific code yet.
