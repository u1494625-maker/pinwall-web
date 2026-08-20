"use client";

import { useState, type KeyboardEvent } from "react";

type TagChipInputProps = {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
};

function normalize(raw: string): string {
  return raw.trim().replace(/^#+/, "");
}

/**
 * Pill-style tag entry that still produces the same string[] the rest of the
 * app already expects from the old comma-separated input — just committed
 * incrementally (Enter/comma) instead of all at once at submit.
 */
export default function TagChipInput({ tags, onTagsChange }: TagChipInputProps) {
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const value = normalize(draft);
    setDraft("");
    if (!value || tags.includes(value)) return;
    onTagsChange([...tags, value]);
  }

  function removeTag(index: number) {
    onTagsChange(tags.filter((_, i) => i !== index));
  }

  // Deliberately NOT committing on Space: today's comma-separated input lets
  // someone type a multi-word tag like "study spot" in one shot — committing
  // on Space would silently break that.
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      // Critical: this input lives inside the same <form> as the publish
      // button — an unprevented Enter would submit/publish the post.
      event.preventDefault();
      commitDraft();
      return;
    }
    if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2.5">
      {tags.map((tag, index) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-full bg-kavanaka-lime/15 px-2.5 py-1 text-xs font-semibold text-kavanaka-green"
        >
          #{tag}
          <button
            type="button"
            onClick={() => removeTag(index)}
            aria-label={`Remove tag ${tag}`}
            className="text-kavanaka-green/60 hover:text-kavanaka-green"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commitDraft}
        placeholder={tags.length === 0 ? "# Topic" : "Add another…"}
        className="min-w-[6rem] flex-1 bg-transparent text-[16px] text-stone-900 outline-none placeholder:text-stone-400 md:text-sm"
      />
    </div>
  );
}
