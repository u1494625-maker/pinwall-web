"use client";

import type { ChangeEvent, RefObject } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import { VIDEO_EXTENSIONS, type CoverAsset, type VideoAsset } from "@/lib/mediaComposer";
import { ALLOWED_VIDEO_TYPES } from "@/lib/storage";

type VideoCoverFieldsProps = {
  video: VideoAsset | null;
  cover: CoverAsset | null;
  videoInputRef: RefObject<HTMLInputElement | null>;
  coverInputRef: RefObject<HTMLInputElement | null>;
  onVideoChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveVideo: () => void;
  onCoverChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveCover: () => void;
  isConvertingHeic: boolean;
};

function assetSrc(asset: VideoAsset | CoverAsset): string {
  return asset.kind === "existing" ? asset.url : asset.previewUrl;
}

/**
 * The two clearly separate sections a video post's composer shows once
 * mode === "video" — Video and Cover — replacing the shared photo media
 * strip entirely for that mode. Rendered from MediaComposerFields, which
 * still owns the single shared "+" tile used for the very first pick (see
 * lib/mediaComposer.ts's handleMediaChange) — once that first pick is a
 * video, everything after happens through this component's own dedicated
 * inputs instead.
 *
 * "Remove" only ever appears once a NEW replacement is staged (kind ===
 * "new") — a video post can never be left with no video/cover at all, so
 * removing a replacement reverts to the original ("existing") asset rather
 * than clearing the slot. See VideoAsset/CoverAsset's doc comments in
 * lib/mediaComposer.ts.
 */
export default function VideoCoverFields({
  video,
  cover,
  videoInputRef,
  coverInputRef,
  onVideoChange,
  onRemoveVideo,
  onCoverChange,
  onRemoveCover,
  isConvertingHeic,
}: VideoCoverFieldsProps) {
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-stone-400">Video</p>
        <input
          ref={videoInputRef}
          type="file"
          accept={`${ALLOWED_VIDEO_TYPES.join(",")},${VIDEO_EXTENSIONS.join(",")}`}
          onChange={onVideoChange}
          className="hidden"
        />
        {video ? (
          <div>
            <video
              src={assetSrc(video)}
              controls
              playsInline
              preload="metadata"
              className="aspect-[4/5] w-full rounded-2xl bg-black object-contain"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                className="rounded-full bg-stone-100 px-3.5 py-1.5 text-[12px] font-bold text-stone-700"
              >
                Replace video
              </button>
              {video.kind === "new" ? (
                <button
                  type="button"
                  onClick={onRemoveVideo}
                  className="rounded-full bg-stone-100 px-3.5 py-1.5 text-[12px] font-bold text-stone-700"
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            className="grid h-40 w-full place-items-center rounded-2xl border border-dashed border-stone-300 bg-white text-2xl text-stone-400"
            aria-label="Add a video"
          >
            +
          </button>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-stone-400">
          Cover <span className="text-red-500">*</span>
        </p>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,.heic,.heif"
          onChange={onCoverChange}
          className="hidden"
        />
        {isConvertingHeic ? (
          <div
            aria-live="polite"
            className="grid size-24 place-items-center rounded-2xl border border-dashed border-stone-300 bg-white text-center text-[10px] font-semibold text-stone-400"
          >
            Converting…
          </div>
        ) : cover ? (
          <div className="relative size-24">
            <DemoPhoto src={assetSrc(cover)} alt="Cover" className="size-24 overflow-hidden rounded-2xl" />
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              aria-label="Change cover"
              className="absolute inset-x-1 bottom-1 rounded-full bg-white/90 py-0.5 text-[10px] font-bold text-stone-700 shadow"
            >
              Change
            </button>
            {cover.kind === "new" ? (
              <button
                type="button"
                onClick={onRemoveCover}
                aria-label="Remove cover"
                className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-stone-900 text-[10px] text-white"
              >
                ×
              </button>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => coverInputRef.current?.click()}
            aria-label="Add a cover image"
            className="grid size-24 place-items-center rounded-2xl border border-dashed border-stone-300 bg-white text-2xl text-stone-400"
          >
            +
          </button>
        )}
        <p className="mt-1.5 text-[11px] text-stone-400">Required before publishing.</p>
      </div>
    </div>
  );
}
