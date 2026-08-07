This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Architecture Overview

The app is a client-heavy Next.js App Router project. There is no backend yet — all
user-generated data (posts, saves) lives in `localStorage` via `lib/posts.ts`, and demo
content lives in `data/demoData.ts`. Routes under `app/` are thin wrappers; the real UI
and logic live in `components/`.

### Home

```
Home
├── app/page.tsx
├── components/PinWallHome.tsx
├── components/TopBar.tsx
└── components/CategoryChips.tsx
```

- **What it does:** The main feed screen — header/search entry point, Following/Explore
  tabs, and the two-column post feed.
- **Entry point:** `app/page.tsx` renders `components/PinWallHome.tsx`, which composes
  `TopBar`, `CategoryChips`, and `MasonryFeed` (from the Posts module) using
  `useAllPosts()` from `lib/posts.ts`.

### Map

```
Map
├── app/map/page.tsx
├── app/map/cluster/[clusterId]/page.tsx
├── components/map/MapPage.tsx
├── components/map/PostMapMarker.tsx
├── components/map/PostClusterMarker.tsx
├── components/map/LocationPicker.tsx
├── components/map/ClusterPostFeedPage.tsx
├── lib/map/clustering.ts
├── lib/map/types.ts
└── lib/map/viewport.ts
```

- **What it does:** Renders location-enabled posts on a Leaflet/OpenStreetMap map with
  zoom-dependent clustering (`lib/map/clustering.ts`, built on `supercluster`), an
  individual-post preview card, and a cluster tap-through feed. `LocationPicker` is the
  tap-to-choose-a-spot map embedded in the Add Post form (Posts module). `lib/map/viewport.ts`
  persists center/zoom to `sessionStorage` so the map doesn't reset on navigation.
- **Entry point:** `app/map/page.tsx` renders `components/map/MapPage.tsx`. The cluster
  feed's entry point is `app/map/cluster/[clusterId]/page.tsx`, which renders
  `components/map/ClusterPostFeedPage.tsx`.

### Posts

```
Posts
├── types/post.ts
├── lib/posts.ts
├── components/PostCard.tsx
├── components/PostDetail.tsx
├── components/MasonryFeed.tsx
├── app/post/[id]/page.tsx
├── app/add/page.tsx
└── app/saved/page.tsx
```

- **What it does:** Owns the `Post` data model and everything for creating, storing,
  listing, and viewing posts. `lib/posts.ts` is the client-side data layer (reads/writes
  `localStorage`, merges demo + user posts, exposes the reactive `useAllPosts()` hook).
  `PostCard`/`MasonryFeed` are the reusable feed UI shared by Home, Saved, and the Map's
  cluster feed. `app/add/page.tsx` is the post-creation form (including the optional
  "Show this post on the map" toggle, which embeds the Map module's `LocationPicker`).
- **Entry point:** `lib/posts.ts` is the data-layer entry point everything else reads
  from. For UI, `app/add/page.tsx` (create) and `app/post/[id]/page.tsx` → `PostDetail`
  (view) are the user-facing entry points.

### Search

```
Search
├── app/search/page.tsx
└── components/SearchScreen.tsx
```

- **What it does:** Search entry (reached via the magnifying-glass icon in `TopBar`),
  recent/trending search chips. Currently reads static `demoRecentSearches` /
  `demoTrendingSearches` — there's no real search/filtering wired up yet.
- **Entry point:** `app/search/page.tsx` renders `components/SearchScreen.tsx`.

### Messages

```
Messages
└── app/messages/page.tsx
```

- **What it does:** Static demo inbox list (avatar, name, preview, unread badge) sourced
  from `demoConversations`. No separate component file — the page itself is the whole
  screen.
- **Entry point:** `app/messages/page.tsx`.

### Profile

```
Profile
├── app/me/page.tsx
└── app/profile/page.tsx
```

- **What it does:** `app/me/page.tsx` is the real profile screen (avatar, stats, recent
  posts) driven by `demoProfile` — this is what `BottomNav`'s "Me" tab links to.
  `app/profile/page.tsx` is a separate "Profile coming soon" placeholder route that
  isn't linked from anywhere in the nav; it appears to be unused/orphaned.
- **Entry point:** `app/me/page.tsx` (the active one).

### Shared Components

```
Shared Components
├── app/layout.tsx
├── app/globals.css
├── components/BottomNav.tsx
├── components/DemoPhoto.tsx
└── data/demoData.ts
```

- **What it does:** Cross-cutting pieces every module depends on. `BottomNav` is the
  global tab bar mounted once in the root layout. `DemoPhoto` is the reusable
  background-image thumbnail primitive used by post cards, map markers, the location
  picker's pin, and avatars. `data/demoData.ts` holds all seed/mock content
  (`demoPosts`, `demoConversations`, `demoProfile`, `demoRecentSearches`,
  `demoTrendingSearches`) — it feeds Home, Posts, Search, Messages, and Profile.
- **Entry point:** `app/layout.tsx` — the root layout every route renders through.
