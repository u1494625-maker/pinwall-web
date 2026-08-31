"use client";

import type { ChangeEvent, RefObject } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import { VIDEO_EXTENSIONS, type MediaComposerItem, type MediaMode, type VideoAsset } from "@/lib/mediaComposer";
import { ALLOWED_IMAGE_TYPES, ALLOWED_MEDIA_TYPES, ALLOWED_VIDEO_TYPES } from "@/lib/storage";
import PerPhotoLocationFields from "./PerPhotoLocationFields";
import PostLocationFields from "./PostLocationFields";
import TagChipInput from "./TagChipInput";
import TitleField from "./TitleField";

function videoAssetSrc(asset: VideoAsset): string {
  return asset.kind === "existing" ? asset.url : asset.previewUrl;
}

// Offered only while mode is null (nothing chosen yet) — see the accept
// prop below, which switches to PHOTO_ONLY_ACCEPT the instant a photo is
// staged, so the OS stops offering Video once photo mode is locked in.
const COMBINED_MEDIA_ACCEPT = `${ALLOWED_MEDIA_TYPES.join(",")},image/heic,image/heif,.heic,.heif,${VIDEO_EXTENSIONS.join(",")}`;
// Photo mode locks the picker to photos only, matching handleMediaFiles'
// own mode-lock rule (lib/mediaComposer.ts) — without this, iOS still
// offered a Video capture mode the app would just reject after the fact.
const PHOTO_ONLY_ACCEPT = `${ALLOWED_IMAGE_TYPES.join(",")},image/heic,image/heif,.heic,.heif`;

type MediaComposerFieldsProps = {
  fileInputRef: RefObject<HTMLInputElement | null>;
  mediaItems: MediaComposerItem[];
  mode: MediaMode;
  showAddMoreTile: boolean;
  isConvertingHeic: boolean;
  onMediaChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveMedia: (key: string) => void;
  onMoveMedia: (key: string, direction: -1 | 1) => void;
  /** Auto-opens the camera capture UI instead of the plain file picker —
   *  only meaningful for the create flow's "Camera" entry point. */
  captureEnvironment?: boolean;

  /** Video-post-only slot — always present (possibly null/no-op) even for a
   *  photo post, since this component's props are shared regardless of mode;
   *  only rendered when mode === "video". */
  video: VideoAsset | null;
  videoInputRef: RefObject<HTMLInputElement | null>;
  onVideoChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveVideo: () => void;

  title: string;
  onTitleChange: (value: string) => void;
  caption: string;
  onCaptionChange: (value: string) => void;
  tags: string[];
  onTagsChange: (tags: string[]) => void;

  showOnMap: boolean;
  onToggleShowOnMap: () => void;
  coords: { lat: number; lng: number } | null;
  onCoordsChange: (coords: { lat: number; lng: number }) => void;
  perPhotoLocationMode: boolean;
  onTogglePerPhotoLocationMode: () => void;
  selectedLocationKeys: Set<string>;
  onTogglePhotoSelection: (key: string) => void;
  onSetLocationForSelected: (coords: { lat: number; lng: number }) => void;
  onClearLocationForSelected: () => void;
};

/**
 * The media strip (add/remove/reorder), title/caption/tags, and map-location
 * section (shared "Show this post on the map" + "More than one location?")
 * shared by MediaPostEditor (create) and EditPostForm's photo-edit path —
 * lifted verbatim out of MediaPostEditor so Edit's screen is guaranteed
 * visually identical to the create composer rather than a hand-copied
 * approximation of it. All state/handlers come from useMediaComposer
 * (lib/mediaComposer.ts); this component is purely presentational.
 */
export default function MediaComposerFields({
  fileInputRef,
  mediaItems,
  mode,
  showAddMoreTile,
  isConvertingHeic,
  onMediaChange,
  onRemoveMedia,
  onMoveMedia,
  captureEnvironment = false,
  video,
  videoInputRef,
  onVideoChange,
  onRemoveVideo,
  title,
  onTitleChange,
  caption,
  onCaptionChange,
  tags,
  onTagsChange,
  showOnMap,
  onToggleShowOnMap,
  coords,
  onCoordsChange,
  perPhotoLocationMode,
  onTogglePerPhotoLocationMode,
  selectedLocationKeys,
  onTogglePhotoSelection,
  onSetLocationForSelected,
  onClearLocationForSelected,
}: MediaComposerFieldsProps) {
  return (
    <>
      {mode === "video" ? (
        <div>
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
                src={videoAssetSrc(video)}
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
      ) : (
      <div>
        <input
          ref={fileInputRef}
          id="media"
          type="file"
          multiple
          // Extension hints (HEIC's own .heic/.heif, and now video's own
          // .mp4/.mov/.webm) alongside the MIME list — iOS Safari doesn't
          // always report a helpful `type` for a file picked from the
          // Photos library, so the accept filter itself needs both signals
          // to reliably offer these files in the native picker. Narrowed to
          // photos only once mode is locked to "photo" — mediaItems.length
          // > 0 is the only way mode becomes "photo" here (this input never
          // renders at all in video mode, see the mode === "video" branch
          // above), so this is the same lock handleMediaFiles itself
          // enforces, just surfaced to the OS instead of only rejected
          // after the fact.
          accept={mode === "photo" ? PHOTO_ONLY_ACCEPT : COMBINED_MEDIA_ACCEPT}
          capture={captureEnvironment ? "environment" : undefined}
          onChange={onMediaChange}
          className="hidden"
        />

        {mediaItems.length === 0 ? (
          isConvertingHeic ? (
            <div
              aria-live="polite"
              className="grid size-24 place-items-center rounded-2xl border border-dashed border-stone-300 bg-white text-center text-[10px] font-semibold text-stone-400"
            >
              Converting…
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Add a photo or video"
              className="grid size-24 place-items-center rounded-2xl border border-dashed border-stone-300 bg-white text-2xl text-stone-400"
            >
              +
            </button>
          )
        ) : (
          <>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {mediaItems.map((item, index) => (
                <div key={item.key} className="relative size-24 shrink-0">
                  <div className="size-24 overflow-hidden rounded-2xl">
                    <DemoPhoto src={item.previewUrl} alt={`Media ${index + 1}`} className="size-full" />
                  </div>

                  {index === 0 ? (
                    <span className="absolute left-1 top-1 rounded-full bg-stone-900/80 px-1.5 py-0.5 text-[9px] font-bold text-white">
                      Cover
                    </span>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => onRemoveMedia(item.key)}
                    aria-label="Remove media"
                    className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-stone-900 text-[10px] text-white"
                  >
                    ×
                  </button>

                  <div className="absolute inset-x-1 bottom-1 flex justify-between">
                    <button
                      type="button"
                      onClick={() => onMoveMedia(item.key, -1)}
                      disabled={index === 0}
                      aria-label="Move left"
                      className="grid size-5 place-items-center rounded-full bg-white/90 text-[10px] font-bold text-stone-700 shadow disabled:invisible"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoveMedia(item.key, 1)}
                      disabled={index === mediaItems.length - 1}
                      aria-label="Move right"
                      className="grid size-5 place-items-center rounded-full bg-white/90 text-[10px] font-bold text-stone-700 shadow disabled:invisible"
                    >
                      ›
                    </button>
                  </div>
                </div>
              ))}

              {showAddMoreTile ? (
                isConvertingHeic ? (
                  <div
                    aria-live="polite"
                    className="grid size-24 shrink-0 place-items-center rounded-2xl border border-dashed border-stone-300 bg-white text-center text-[10px] font-semibold text-stone-400"
                  >
                    Converting…
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Add more media"
                    className="grid size-24 shrink-0 place-items-center rounded-2xl border border-dashed border-stone-300 bg-white text-2xl text-stone-400"
                  >
                    +
                  </button>
                )
              ) : null}
            </div>
          </>
        )}
      </div>
      )}

      <TitleField value={title} onChange={onTitleChange} />

      <textarea
        id="caption"
        value={caption}
        onChange={(event) => onCaptionChange(event.target.value)}
        rows={6}
        placeholder="Share something…"
        className="w-full resize-none border-none bg-transparent text-base leading-relaxed text-stone-900 outline-none placeholder:text-stone-400"
      />

      <TagChipInput tags={tags} onTagsChange={onTagsChange} />

      {/* "More than one location?" is nested inside PostLocationFields' own
          showOnMap section (via children) so it — and everything below it —
          only ever appears while "Show this post on the map" is on. */}
      <PostLocationFields
        showOnMap={showOnMap}
        onToggleShowOnMap={onToggleShowOnMap}
        coords={coords}
        onCoordsChange={onCoordsChange}
        hidePicker={perPhotoLocationMode}
      >
        {mode === "photo" && mediaItems.length > 1 ? (
          <>
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-kavanaka-aqua/10 px-4 py-3">
              <div>
                <p className="text-[12px] font-semibold text-kavanaka-aqua">More than one location?</p>
                <p className="mt-0.5 text-[11px] text-stone-600">Set locations for individual photos.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={perPhotoLocationMode}
                aria-label="Turn per-photo locations on or off"
                onClick={onTogglePerPhotoLocationMode}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  perPhotoLocationMode ? "bg-kavanaka-aqua" : "bg-stone-200"
                }`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                    perPhotoLocationMode ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {perPhotoLocationMode ? (
              <PerPhotoLocationFields
                photos={mediaItems}
                selectedKeys={selectedLocationKeys}
                onTogglePhoto={onTogglePhotoSelection}
                onSetLocationForSelected={onSetLocationForSelected}
                onClearLocationForSelected={onClearLocationForSelected}
              />
            ) : null}
          </>
        ) : null}
      </PostLocationFields>
    </>
  );
}
