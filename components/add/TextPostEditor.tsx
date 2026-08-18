"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import ComposerBottomBar from "@/components/add/ComposerBottomBar";
import ComposerTopBar from "@/components/add/ComposerTopBar";
import PostLocationFields from "@/components/add/PostLocationFields";
import TagChipInput from "@/components/add/TagChipInput";
import TextTemplatePicker from "@/components/add/TextTemplatePicker";
import TitleField from "@/components/add/TitleField";
import { useAuth } from "@/lib/auth/AuthProvider";
import { addPost } from "@/lib/posts";
import { DEFAULT_TEXT_TEMPLATE, type TextTemplateId } from "@/lib/textTemplates";

export default function TextPostEditor() {
  const router = useRouter();
  const { user } = useAuth();

  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [template, setTemplate] = useState<TextTemplateId>(DEFAULT_TEXT_TEMPLATE);
  const [tags, setTags] = useState<string[]>([]);
  const [showOnMap, setShowOnMap] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // If the session drops mid-edit, RequireAuth swaps this whole page to
    // LoginScreen on its own — this guard just protects the submit itself.
    if (!user) return;

    if (!title.trim()) {
      setError("Add a title before publishing.");
      return;
    }

    if (!caption.trim()) {
      setError("Write something before publishing.");
      return;
    }

    if (showOnMap && !coords) {
      setError("Choose a location on the map before publishing.");
      return;
    }

    setIsSubmitting(true);

    try {
      await addPost({
        title: title.trim(),
        caption: caption.trim(),
        tags,
        rating: 0,
        ratingCount: "New",
        showOnMap,
        latitude: showOnMap ? coords?.lat : undefined,
        longitude: showOnMap ? coords?.lng : undefined,
        userId: user.id,
        media: [],
        textTemplate: template,
      });

      router.replace("/me");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <ComposerTopBar />

      <form onSubmit={handleSubmit} className="space-y-5 px-5 pt-4">
        <TitleField value={title} onChange={setTitle} />

        <textarea
          id="caption"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          rows={10}
          placeholder="Share something useful…"
          className="w-full resize-none border-none bg-transparent text-base leading-relaxed text-stone-900 outline-none placeholder:text-stone-400"
        />

        <TextTemplatePicker template={template} onTemplateChange={setTemplate} title={title} />

        <TagChipInput tags={tags} onTagsChange={setTags} />

        <PostLocationFields
          showOnMap={showOnMap}
          onToggleShowOnMap={() => setShowOnMap((prev) => !prev)}
          coords={coords}
          onCoordsChange={setCoords}
        />

        <ComposerBottomBar isSubmitting={isSubmitting} error={error} />
      </form>
    </main>
  );
}
