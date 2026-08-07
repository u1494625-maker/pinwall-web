"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import PostLocationFields from "@/components/add/PostLocationFields";
import { useAuth } from "@/lib/auth/AuthProvider";
import { addPost } from "@/lib/posts";

export default function TextPostEditor() {
  const router = useRouter();
  const { user } = useAuth();

  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [showOnMap, setShowOnMap] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationName, setLocationName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // If the session drops mid-edit, RequireAuth swaps this whole page to
    // LoginScreen on its own — this guard just protects the submit itself.
    if (!user) return;

    if (!caption.trim()) {
      setError("Write something before publishing.");
      return;
    }

    if (showOnMap && (!coords || !locationName.trim())) {
      setError("Choose a location on the map before publishing.");
      return;
    }

    setIsSubmitting(true);

    try {
      const authorName = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "Anonymous";
      const trimmedTitle = title.trim();

      const post = await addPost({
        postType: "text",
        image: null,
        imageAlt: null,
        imageAspect: null,
        title: trimmedTitle ? trimmedTitle : null,
        caption: caption.trim(),
        tags: tagsInput
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        author: authorName,
        rating: 0,
        ratingCount: "New",
        showOnMap,
        latitude: showOnMap ? coords?.lat : undefined,
        longitude: showOnMap ? coords?.lng : undefined,
        locationName: showOnMap ? locationName.trim() : undefined,
        userId: user.id,
      });

      router.push(`/post/${post.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] px-5 pb-28 pt-8 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600">Share a thought</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight">Write a Post</h1>
        <p className="mt-1 text-sm text-stone-500">No photo needed — just tell people what&rsquo;s on your mind.</p>
      </header>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <div>
          <label className="text-xs font-bold text-stone-700" htmlFor="title">
            Title <span className="font-normal text-stone-400">(optional)</span>
          </label>
          <input
            id="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Give it a headline, or leave this blank"
            className="mt-1.5 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-400"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-stone-700" htmlFor="caption">
            What&rsquo;s on your mind?
          </label>
          <textarea
            id="caption"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            rows={10}
            placeholder="Share a tip, a story, a question…"
            className="mt-1.5 w-full rounded-xl border border-stone-200 bg-white px-3 py-3 text-base leading-relaxed outline-none focus:border-orange-400"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-stone-700" htmlFor="tags">
            Tags
          </label>
          <input
            id="tags"
            value={tagsInput}
            onChange={(event) => setTagsInput(event.target.value)}
            placeholder="coffee, downtown, workspot"
            className="mt-1.5 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-400"
          />
          <p className="mt-1 text-[11px] text-stone-400">Separate tags with commas.</p>
        </div>

        <PostLocationFields
          showOnMap={showOnMap}
          onToggleShowOnMap={() => setShowOnMap((prev) => !prev)}
          coords={coords}
          onCoordsChange={setCoords}
          locationName={locationName}
          onLocationNameChange={setLocationName}
        />

        {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}

        <div className="flex gap-3 pt-2">
          <Link
            href="/"
            className="flex-1 rounded-full border border-stone-300 px-5 py-3 text-center text-sm font-bold text-stone-700"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 rounded-full bg-stone-900 px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
          >
            {isSubmitting ? "Publishing…" : "Publish"}
          </button>
        </div>
      </form>
    </main>
  );
}
