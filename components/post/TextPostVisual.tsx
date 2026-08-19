import type { TextTemplateId } from "@/lib/textTemplates";

export type TextPostVisualSize = "card" | "detail" | "map";

type TextPostVisualProps = {
  template: TextTemplateId;
  /** The post's title — the template is the post's visual cover, and the
   *  title is what a cover shows, exactly like a photo cover shows the
   *  photo. The caption/body is never rendered here; it stays real,
   *  unstyled text below the visual in PostCard/PostDetail/PostMapMarker. */
  text: string;
  size?: TextPostVisualSize;
};

type TemplateVisualProps = {
  text: string;
  size: TextPostVisualSize;
};

// Headline-style sizing: clearly larger than body text, with a tight
// (rather than relaxed) leading so a short title reads as a designed cover,
// not a paragraph. "map" stays small (a fixed 80x80px marker box) but is
// still bumped up from its previous near-illegible size.
const BODY_TEXT_SIZE: Record<TextPostVisualSize, string> = {
  card: "text-2xl leading-tight",
  detail: "text-3xl leading-tight",
  map: "text-[8px] leading-[9px]",
};

// Every template is portrait (4:5) at card/detail size, but a Map marker is a
// fixed square box (see PostMapMarker/MapPage's iconSize:[80,80]) — rather
// than resize that box (risking the anchor math it was carefully tuned
// around), the "map" size renders the same template cropped to a square.
const ASPECT_CLASS: Record<TextPostVisualSize, string> = {
  card: "aspect-[4/5]",
  detail: "aspect-[4/5]",
  map: "aspect-square",
};

function NoteVisual({ text, size }: TemplateVisualProps) {
  const outerPad = size === "card" ? "p-3" : size === "map" ? "p-1" : "p-5";
  const paperPad = size === "card" ? "p-4" : size === "map" ? "p-1.5" : "p-7";
  const paperclipClass = size === "card" ? "left-4 top-1 h-9 w-6" : size === "map" ? "left-1 top-0.5 h-4 w-3" : "left-7 top-2 h-14 w-9";
  const stickyNoteClass = size === "card" ? "bottom-2 right-2 size-9" : size === "map" ? "bottom-0.5 right-0.5 size-3" : "bottom-3 right-3 size-14";

  return (
    <div className={`relative flex ${ASPECT_CLASS[size]} w-full flex-col overflow-hidden rounded-2xl bg-amber-400 ${outerPad}`}>
      <div className={`relative flex min-h-0 flex-1 flex-col justify-center rounded-xl bg-[#fffdf8] shadow-[0_4px_14px_rgba(120,90,20,0.18)] ${paperPad}`}>
        <p className={`overflow-hidden whitespace-pre-wrap break-words text-center font-bold text-stone-800 ${BODY_TEXT_SIZE[size]}`}>
          {text}
        </p>
      </div>

      {/* Paperclip, overlapping the paper's top-left seam. */}
      <svg
        viewBox="0 0 24 40"
        aria-hidden="true"
        className={`absolute ${paperclipClass} text-stone-400 drop-shadow-sm`}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
      >
        <path d="M6 10v18a5 5 0 0 0 10 0V8a3 3 0 0 0-6 0v17" />
      </svg>

      {/* Sticky note, tucked behind the paper's bottom-right corner. */}
      <div aria-hidden="true" className={`absolute rotate-6 rounded-sm bg-amber-200 shadow-sm ${stickyNoteClass}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="#8a6a2a" strokeWidth={2} strokeLinecap="round" className="size-full p-2">
          <path d="M6 13c1.5 2 4 3.5 6 0" />
        </svg>
      </div>
    </div>
  );
}

function QuoteVisual({ text, size }: TemplateVisualProps) {
  const pad = size === "card" ? "px-4 py-6" : size === "map" ? "px-1.5 py-2" : "px-7 py-10";
  const markSize = size === "card" ? "text-4xl" : size === "map" ? "text-xs" : "text-6xl";

  return (
    <div className={`flex ${ASPECT_CLASS[size]} w-full flex-col justify-center overflow-hidden rounded-2xl bg-[#f3ead9] ${pad}`}>
      <span className={`${markSize} font-black leading-none text-[#8a3b2c]/70`} aria-hidden="true">
        &ldquo;
      </span>
      <p className={`whitespace-pre-wrap break-words text-center font-black text-[#7a2e22] ${BODY_TEXT_SIZE[size]}`}>{text}</p>
      <span className={`self-end ${markSize} font-black leading-none text-[#8a3b2c]/50`} aria-hidden="true">
        &rdquo;
      </span>
    </div>
  );
}

function MemoVisual({ text, size }: TemplateVisualProps) {
  const pad = size === "card" ? "px-4 pb-4 pt-5" : size === "map" ? "px-1.5 pb-1.5 pt-2" : "px-7 pb-7 pt-9";
  // Kept in lockstep with BODY_TEXT_SIZE's leading for each size — the ruled
  // background lines are generated from this value, so it must track
  // whatever line-height the headline text actually renders at.
  const lineHeightPx = size === "card" ? 30 : size === "map" ? 9 : 38;

  return (
    <div
      className={`flex ${ASPECT_CLASS[size]} w-full flex-col justify-center overflow-hidden rounded-2xl bg-white ${pad}`}
      style={{
        backgroundImage: `linear-gradient(#eceae4 1px, transparent 1px), linear-gradient(#d8d5cc 1px, transparent 1px)`,
        backgroundSize: `100% ${lineHeightPx}px, 100% ${lineHeightPx * 5}px`,
        backgroundPosition: `0 ${lineHeightPx - 1}px, 0 ${lineHeightPx - 1}px`,
      }}
    >
      <p
        className={`overflow-hidden whitespace-pre-wrap break-words text-center font-semibold text-stone-700 ${BODY_TEXT_SIZE[size]}`}
        style={{ lineHeight: `${lineHeightPx}px` }}
      >
        {text}
      </p>
    </div>
  );
}

function BasicVisual({ text, size }: TemplateVisualProps) {
  const pad = size === "card" ? "p-4" : size === "map" ? "p-1.5" : "p-7";
  const markSize = size === "card" ? "text-2xl" : size === "map" ? "text-xs" : "text-4xl";

  return (
    <div className={`relative flex ${ASPECT_CLASS[size]} w-full flex-col justify-center overflow-hidden rounded-2xl bg-sky-200 ${pad}`}>
      <span className={`mb-2 text-center ${markSize} font-black leading-none text-sky-400`} aria-hidden="true">
        &ldquo;
      </span>
      <p className={`whitespace-pre-wrap break-words text-center font-black text-stone-800 ${BODY_TEXT_SIZE[size]}`}>{text}</p>
      <span aria-hidden="true" className="absolute bottom-4 right-4 h-1 w-6 rounded-full bg-sky-400" />
    </div>
  );
}

const TEMPLATE_VISUALS: Record<TextTemplateId, typeof NoteVisual> = {
  note: NoteVisual,
  quote: QuoteVisual,
  memo: MemoVisual,
  basic: BasicVisual,
};

/** Renders a templated text post's visual cover — the shared entry point for
 *  PostCard ("card" size), PostDetail ("detail" size), Map markers ("map"
 *  size — a square crop of the same template, never a resized/rasterized
 *  copy), and TextTemplatePicker's live preview. Pure presentation: always
 *  renders `text` (the post's title) verbatim, never truncates or paginates
 *  it — a title already has a short, controlled max length (see
 *  components/add/TitleField.tsx), so it always fits on one visual as-is. */
export default function TextPostVisual({ template, text, size = "card" }: TextPostVisualProps) {
  const Visual = TEMPLATE_VISUALS[template];
  return <Visual text={text} size={size} />;
}
