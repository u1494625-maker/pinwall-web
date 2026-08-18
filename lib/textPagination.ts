import { TEXT_TEMPLATES, type TextTemplateId } from "@/lib/textTemplates";

/**
 * Pure text -> pages splitting, no React, no DOM measurement. Deliberately
 * simple: each template has a fixed character budget (lib/textTemplates.ts)
 * and text is packed into pages up to that budget, always breaking at a
 * boundary — paragraph, then sentence, then whitespace/word — and only ever
 * hard-cutting mid-word as an absolute last resort (a single "word" with no
 * spaces at all, e.g. a long URL, longer than the whole budget). Pages are
 * never stored — this runs at render time, in both the composer's preview
 * and PostCard/PostDetail, from the post's own stored caption.
 */

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=\S)/;
const WORD_BOUNDARY = /\s+/;

/** Splits `text` at successively finer boundaries until every piece fits
 *  within `budget`. Never invoked on text that already fits (callers check
 *  first), so it always does at least one real split. */
function splitToFit(text: string, budget: number, level: 0 | 1 = 0): string[] {
  if (text.length <= budget) return [text];

  const pattern = level === 0 ? SENTENCE_BOUNDARY : WORD_BOUNDARY;
  const units = text
    .split(pattern)
    .map((unit) => unit.trim())
    .filter(Boolean);

  if (units.length <= 1) {
    // No sentence punctuation (level 0) or no whitespace at all (level 1) —
    // fall through to the next, finer boundary. Level 1 with nothing left to
    // split on means a single run with no spaces longer than the whole
    // budget (e.g. a URL) — hard-cut it, the only case that ever happens.
    if (level === 0) return splitToFit(text, budget, 1);
    return hardSplit(text, budget);
  }

  return units.flatMap((unit) => (unit.length > budget ? splitToFit(unit, budget, 1) : [unit]));
}

function hardSplit(text: string, budget: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > budget) {
    pieces.push(rest.slice(0, budget));
    rest = rest.slice(budget);
  }
  if (rest.length > 0) pieces.push(rest);
  return pieces;
}

type TextChunk = {
  text: string;
  /** Whether this chunk is the start of a new source paragraph — controls
   *  whether packChunks rejoins it with a blank line (paragraph break) or a
   *  single space (same-paragraph continuation) when two chunks land on the
   *  same page. */
  startsNewParagraph: boolean;
};

/** Splits the whole caption into paragraph-tagged chunks, each already
 *  small enough to fit on its own page — sub-splitting only the paragraphs
 *  that are individually too long. */
function buildChunks(text: string, budget: number): TextChunk[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return paragraphs.flatMap((paragraph) => {
    const pieces = paragraph.length <= budget ? [paragraph] : splitToFit(paragraph, budget);
    return pieces.map((piece, index) => ({ text: piece, startsNewParagraph: index === 0 }));
  });
}

/** Greedily packs chunks onto as few pages as possible, in order, without
 *  ever exceeding budget or reordering content. */
function packChunks(chunks: TextChunk[], budget: number): string[] {
  const pages: string[] = [];
  let current = "";

  for (const chunk of chunks) {
    const separator = current ? (chunk.startsNewParagraph ? "\n\n" : " ") : "";
    const candidate = `${current}${separator}${chunk.text}`;
    if (candidate.length <= budget) {
      current = candidate;
    } else {
      if (current) pages.push(current);
      current = chunk.text;
    }
  }
  if (current) pages.push(current);
  return pages;
}

/** Splits a post's caption into template-sized visual pages. Always returns
 *  at least one page (a single empty-string page for empty input, so
 *  callers never need a special case). The original caption itself is never
 *  modified — this only ever reads it. */
export function paginateText(text: string, templateId: TextTemplateId): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [""];

  const budget = TEXT_TEMPLATES[templateId].characterBudget;
  if (trimmed.length <= budget) return [trimmed];

  const pages = packChunks(buildChunks(trimmed, budget), budget);
  return pages.length > 0 ? pages : [trimmed];
}
