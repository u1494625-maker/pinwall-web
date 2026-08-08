# Pinwall — Current State

A mobile-first (single-column, `max-w-md`) campus discovery app: students post spots (cafés, food, study spots, events) as image, video, or text posts, browse them on a masonry feed or an interactive map, and search across them. Built with Next.js 16 (App Router) + React 19 + Tailwind v4, backed by Supabase (Postgres + Auth + Storage).

This document describes what the app **is today**. For how it got here, see `CHANGELOG.md`. If this file and the code ever disagree, the code is correct — re-verify before trusting a stale description.

## Tech stack

- **Framework**: Next.js 16.3.0 (App Router, Turbopack), React 19.2.8.
- **Styling**: Tailwind CSS v4, zero-config (`@import "tailwindcss"` in `app/globals.css`, no `tailwind.config.*`). Two CSS variables (`--background`, `--foreground`), no dark mode, no custom font (`Arial, Helvetica, sans-serif`).
- **Backend**: Supabase — Postgres (`posts` table), Auth (Google OAuth only, no other providers, no password auth), Storage (public `post-image` bucket, user-scoped folders).
- **Map**: Leaflet 1.9.4 + Supercluster 8.0.1, both dynamically imported client-side only (never SSR'd).
- **HEIC conversion**: `heic-to` 1.5.2, dynamically imported only when a HEIC/HEIF file is actually selected.
- **No test framework** is configured (no jest/vitest). Verification throughout this project has been `eslint` + `tsc --noEmit` + `next build` + manual/Playwright-scripted QA.

## Routes

| Route | Purpose | Auth |
|---|---|---|
| `/` | Home — Following / Explore / Maps tabs | Following tab requires login |
| `/map` | Interactive map, always mounts regardless of post count | Public |
| `/map/cluster/[clusterId]` | Regional feed for a tapped cluster (reuses `MasonryFeed`) | Public |
| `/add`, `/add/media`, `/add/text` | Post composer (image/video vs. text-only) | Required |
| `/post/[id]` | Post Detail | Public (no `RequireAuth`) |
| `/me` | Profile — own Posts / Saved tabs | Required |
| `/saved` | Saved posts (localStorage-backed, device-local) | Public |
| `/search` | Smart Search | Public |
| `/messages` | Demo-only inbox UI (hardcoded conversations, no backend) | Required |
| `/profile` | Stub page, superseded by `/me`, not linked from anywhere live | Public |

Global `BottomNav` (Home / Map / + / Messages / Me) renders on every route **except** `/search`, `/post/*`, and `/add*` (hidden so those routes' own UI — search results, the post action bar, the composer's publish bar — isn't crowded by it).

## Data model

`types/post.ts`'s `Post`:
```ts
{
  id: number;
  postType: "image" | "video" | "text";
  image: string | null;        // null for text posts
  imageAlt: string | null;
  imageAspect: string | null;  // see "Image aspect ratio" below
  title: string | null;        // optional for text posts
  caption: string;             // always required
  tags: string[];
  author: string;              // display name, not a foreign key
  rating: number;               // vestigial, see "Known dead weight" below
  ratingCount: string;          // vestigial
  showOnMap: boolean;
  latitude?: number;
  longitude?: number;
  locationName?: string;       // optional even when showOnMap is true
  userId?: string;
  createdAt?: string;
}
```

**Supabase schema** (`supabase/*.sql`, cumulative, never migrated automatically — each file documents itself as "run manually in the SQL editor"):
- `schema.sql` — base `posts` table, open RLS (pre-auth).
- `auth_and_ownership.sql` — adds `user_id` (nullable, `on delete set null`), tightens RLS to `auth.uid() = user_id` for insert/update/delete, public read stays open; adds the `post-image` storage-folder-ownership policy.
- `post_types_and_media.sql` — adds `post_type` (`check in ('image','video','text')`, default `'image'`), relaxes `NOT NULL` on `image`/`title`/`image_alt`/`image_aspect` so text posts can omit them.
- `post_deletion.sql` — adds `grant delete on table public.posts to authenticated` (RLS alone wasn't sufficient — see Post Detail below) plus Storage `select`/`delete` RLS policies on `storage.objects` (own-folder-scoped, mirroring the existing upload policy) so an owner's post-delete flow can actually remove their media object, not just the `posts` row.
- `post_editing.sql` — adds `grant update on table public.posts to authenticated`, the same table-privilege gap anticipated proactively for Edit after being discovered the hard way for Delete. The existing `"Users can update their own posts"` RLS policy (`auth_and_ownership.sql`) is unchanged.
- No `comments`, `likes`, or `follows` tables exist anywhere. No `is_private`/visibility column exists yet — every post is publicly readable.

**Image aspect ratio** (`lib/postDisplay.ts`): `image_aspect` is a free-text column with two coexisting formats — legacy rows store a literal Tailwind class string (`"aspect-[4/5]"`, still used verbatim by video posts today), new image uploads store a bare `"width/height"` ratio (e.g. `"4032/3024"`, the file's real measured dimensions). `resolveImageAspectRatio()` extracts the numeric ratio from either format via one regex and falls back to `DEFAULT_IMAGE_ASPECT_RATIO` ("4/5") for anything unparseable. Consumers (`PostCard`, `app/me/page.tsx`'s grid tiles, `PostDetail`) apply it as an inline `style={{ aspectRatio }}`, never as a runtime-constructed Tailwind class (which Tailwind's static scanner couldn't detect). `measureImageAspectRatio()` reads a real image's natural dimensions client-side at publish time via `new Image()`; publishing blocks (a real error, not a silent fallback) if measurement fails.

## Authentication

`lib/auth/AuthProvider.tsx` wraps the whole app (`app/layout.tsx`), backed by Supabase Auth, **Google OAuth only**. `RequireAuth` (`components/auth/RequireAuth.tsx`) renders `LoginScreen` in place — no redirect — when signed out; used by `/add*`, `/me`, `/messages`. `/post/[id]` is deliberately public. Home's Following tab reuses the same loading/signed-out pattern inline rather than via `RequireAuth`.

## Home feed (`components/PinWallHome.tsx`)

Three tabs via `CategoryChips`:
- **Following** — requires login; no real follow relationships exist, so this is permanently a static placeholder ("Posts from people you follow will appear here").
- **Explore** — every post (`useAllPostsState()`), rendered through `MasonryFeed`.
- **Maps** — posts filtered to the last *intentionally selected* Map viewport (`lib/map/viewport.ts`'s `useSavedMapViewport()` + `filterPostsInBounds()`), not geolocation. Three distinct states: no area ever selected → "Choose an area on the Map…"; area selected but genuinely zero posts in it → "No posts in this area yet"; area selected with results → the feed plus a small "Change area ›" link. Never falls back to `MasonryFeed`'s generic empty copy for the latter two — that copy is reserved for genuine platform-wide emptiness.

All three post-loading tabs (Explore, Maps, and `SearchScreen`) share a `FeedSkeleton` (exported from `components/MasonryFeed.tsx`) shown while `useAllPostsState()`'s `loading` is `true`, so a slow fetch never flashes a wrong empty/not-found state.

`MasonryFeed` is a `columns-2 gap-2.5 px-3` CSS-column masonry (true independent-column stacking, not a row-aligned grid) wrapping `PostCard`s.

`PostCard` (the only feed/search-result card — reused everywhere, never duplicated): media block (image via `DemoPhoto` with the real aspect ratio; video via `PostVideoTile`; **text posts render no media element at all**, not a placeholder box) → title (`line-clamp-2`, capped at 2 lines) → a compact author row (initial-letter avatar circle + name) below the title. No caption, no tags, no save/heart button anywhere on the card — Save only exists in Post Detail's bottom bar.

## Map system

- **Viewport persistence** (`lib/map/viewport.ts`): the *ambient* viewport (last camera position + geographic bounds) persists in `sessionStorage`, saved on mount and on every debounced pan/zoom. This is what drives Home's Maps tab.
- **Clustering** (`lib/map/clustering.ts`): Supercluster, radius 60, maxZoom 17. Far zoom → numbered clusters; close zoom → individual pins. Tapping a cluster navigates to `/map/cluster/[id]` (a real regional feed reusing `MasonryFeed`, not just a zoom).
- **Map always mounts**, regardless of post count — it's an area-selection tool, not gated on having something to show.
- **View on Map** (`?postId=` on `/map`): Post Detail's location link opens `/map?postId=<id>`, which centers/zooms/highlights that exact pin (a lightweight ring + pulse on the marker) without disturbing the ambient viewport — a *targeted* camera move is explicitly distinguished from an *ambient* one via a suppress-flag so it's never persisted as the user's chosen area unless they manually pan/zoom afterward.
- Leaflet renders markers as static HTML strings (`renderToStaticMarkup` → `divIcon`) — no live React state/handlers on markers themselves; interactivity is wired via Leaflet's own `.on('click')`.

## Post creation (`components/add/MediaPostEditor.tsx` / `TextPostEditor.tsx`)

Reached via `BottomNav`'s "+" action sheet (Album / Camera / Text). `/add` and `/add/media` render the identical `MediaPostEditor` (two entry points, one component). Mobile-native composer chrome: a bare "‹" `ComposerTopBar`, a compact single-slot media tile (no multi-image support — `Post.image` is one field, not an array), a shared `TitleField` (40-char hard limit with a live counter), a hashtag-style `TagChipInput` (commits on Enter/comma, not Space, so multi-word tags stay possible), `PostLocationFields` (a slim "Show this post on the map" toggle that, when on, keeps the Leaflet `LocationPicker` visibly open at all times — no collapse-on-first-pin), and a full-width `ComposerBottomBar` "Post" button.

**Location rule**: showing on map requires only a placed pin — there is no place-name/address field anymore; `locationName` is simply absent for new coordinate-only posts (Post Detail's location link already falls back to "View on Map" text when `locationName` is missing).

**HEIC/HEIF** (`lib/heic.ts`): detected by MIME type or filename extension (iOS often reports an empty MIME type for HEIC), converted client-side to JPEG before anything else touches the file. HEIC sources get a more generous 15MB ceiling (vs. the standard 5MB image limit) since HEIC's compression means a legitimate photo can exceed 5MB pre-conversion; the converted JPEG is retried at descending quality (0.9 → 0.7 → 0.5) until it fits the real 5MB limit, or publishing fails with a clear error rather than silently uploading an oversized file.

On successful publish, both editors `router.replace("/me")` (not `push`, and not `/post/[id]`) — so Back never returns to the submitted composer.

## Post Detail (`components/PostDetail.tsx`)

Top bar (back, initial-letter avatar, author name + relative date, real Web Share API share button) renders **before** the media, identically for every post type — not overlaid on the media, and not conditional on who's viewing (no Follow button exists — omitted entirely rather than shipped as a dead control). Image media uses the real aspect ratio (no forced 4:3 crop). Below the media: location (if valid coordinates exist), title, caption, tags, then a Comments section with an honest empty state and a visibly-`disabled` composer input (no comments backend exists — this is UI-only, structurally ready). A fixed bottom bar has exactly two real actions, Save and Comment (scrolls to the Comments section) — no fake "Like," no hardcoded engagement counts anywhere. While `useAllPostsState()` is loading, a skeleton renders instead of a premature "Post not found."

**Owner-only post management (Phase 2 of 3 — Delete + Edit; Privacy still unstarted):** if the signed-in user's id matches `post.userId`, a subtle "Manage post" entry renders just above the fixed bottom bar (absent from the DOM entirely for non-owners, not just hidden). Tapping it opens `components/post/PostManageSheet.tsx`, a Pinwall-styled bottom sheet (same native-`<dialog>` slide-up pattern as `components/add/AddPostActionSheet.tsx`) listing all three eventual actions — **Privacy** is still visibly present but `disabled` ("Soon", no fake behavior); **Edit** and **Delete** are both fully functional.

*Delete*: requires an explicit confirm step (irreversible), then: derives the post's Storage object path from its stored public URL via `getStoragePathFromPublicUrl()` (`lib/storage.ts` — no separate stored-path column), removes it via the existing `deletePostMedia()`, then deletes the row via `deletePost()` (`lib/posts.ts`). If the media step fails, the DB row is never touched; if the Storage path can't be derived at all, deletion stops with an error rather than orphaning the file; if the DB delete fails after Storage succeeded, a retry only repeats the DB delete (tracked via a local ref, never re-runs the Storage removal). On success, redirects to `/me`.

*Edit* (`/post/[id]/edit` → `components/post/EditPostForm.tsx`): title, caption, tags, and show-on-map/coordinates only — **media, `post_type`, and ownership are never editable**, and the image/video (if any) renders as a read-only preview at the top of the form (branching on `post.postType`, the same way `PostDetail` already does). One shared form handles all three post types, since removing media-replacement from scope removes the only real difference between them. Validation matches the original composer: caption always required, title required for image/video posts but optional for text posts, coordinates required whenever "Show on Map" is on. Turning "Show on Map" off and saving clears `latitude`/`longitude` to `null` rather than leaving them dormant. `updatePost()` (`lib/posts.ts`) only ever writes title/caption/tags/show_on_map/latitude/longitude — `location_name` is left untouched (no UI for it in this phase). The page itself re-derives ownership the same way Post Detail does (`useAuth()` + `post.userId`) and renders a clear denial/not-found state rather than the form for non-owners or signed-out visitors — that check is a UI convenience only; the real boundary is Postgres RLS.

Both `deletePost()` and `updatePost()` follow the same verified-write pattern: chain `.select("id")` onto the mutation and throw if zero rows come back, so an RLS-silenced no-op (e.g. a missing table-level `GRANT`) is never mistaken for success. This was learned the hard way with Delete — a real end-to-end test against the live Supabase project found that the `authenticated` role needed an explicit `grant delete on table public.posts` *in addition to* the existing RLS policy, and that Storage's `remove()` needed a `select` policy alongside its `delete` policy (`supabase/post_deletion.sql`). The same gap was anticipated proactively for Edit (`supabase/post_editing.sql`, adding `grant update on table public.posts to authenticated`) rather than rediscovered.

Privacy (Public/Private, including a real `is_private` column/RLS and feed-level filtering) is deliberately unstarted — see the plan history for the intended follow-up phase.

## Search (`components/SearchScreen.tsx`, `lib/search.ts`)

Real client-side keyword search over the already-loaded post list (no new Supabase query, no schema change — appropriate at current post volume; server-side full-text search is the natural next step once that stops being true). `searchPosts(posts, query)` tokenizes the query, scores each post by weighted substring matches (title 5 > tags 4 > location 3 > caption 2 > author 1), drops zero-score posts, and sorts by score then an explicit `createdAt` tie-break. The URL (`/search?q=...`, `+`-joined) is the source of truth — the input is a local draft synced to it only on submit, so reloading a shared search link reproduces the same results and pre-fills the box. Renders through the same `MasonryFeed`/`PostCard`/`FeedSkeleton` as Home — no separate search-result design. No embeddings/semantic/LLM search yet.

## Me / Saved / Messages

- **Me** (`app/me/page.tsx`): profile header (avatar, name, email, Edit Profile/Log out) is untouched scaffold; Posts/Saved tabs render through the *exact same* `PostCard`/`MasonryFeed` as Home (no separate grid-tile design anymore).
- **Saved**: `localStorage`-backed (`pinwall_saved` key + a `pinwall-saved-change` custom event for same-tab reactivity via `useSyncExternalStore`), device-local, not tied to the logged-in account.
- **Messages**: fully hardcoded demo data (`data/demoData.ts`'s `demoConversations`) behind `RequireAuth` — no real backend.

## Known dead weight / deferred features (do not build around these as if real)

- `rating`/`ratingCount` columns exist and are still written (hardcoded `0`/`"New"`) on every post, but are not displayed anywhere anymore (removed from both `PostCard` and `PostDetail`). Nothing reads them for display; not worth removing from the schema/type without a reason to touch the schema.
- No comments, likes, or follows backend exists at all — every UI surface referencing them (Following tab, Messages shortcuts, Post Detail's Comments section) is either a static placeholder or structurally-ready-but-inert by design, never faked with hardcoded data.
- `/profile` is a stub, not linked from any live navigation.
- No dark mode, no custom fonts, no CSP.
