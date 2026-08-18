export type TextTemplateId = "note" | "quote" | "memo" | "basic";

export type TextTemplateConfig = {
  id: TextTemplateId;
  label: string;
  /** Characters per visual page — a simple, deterministic budget consumed by
   *  paginateText (lib/textPagination.ts) to decide where a long caption
   *  needs to split into another page. Tuned per template's typical
   *  decoration overhead/text density, not measured from the DOM — see
   *  lib/textPagination.ts's own doc comment for why this stays a plain
   *  constant instead of a runtime fit-measurement. */
  characterBudget: number;
  /** Solid background swatch for the template-picker button — matches each
   *  template's own outer card background. */
  swatchClassName: string;
};

export const TEXT_TEMPLATE_IDS: TextTemplateId[] = ["note", "quote", "memo", "basic"];

export const TEXT_TEMPLATES: Record<TextTemplateId, TextTemplateConfig> = {
  note: {
    id: "note",
    label: "Note",
    characterBudget: 220,
    swatchClassName: "bg-amber-400",
  },
  quote: {
    id: "quote",
    label: "Quote",
    characterBudget: 180,
    swatchClassName: "bg-[#f3ead9]",
  },
  memo: {
    id: "memo",
    label: "Memo",
    characterBudget: 320,
    swatchClassName: "border border-stone-200 bg-white",
  },
  basic: {
    id: "basic",
    label: "Basic",
    characterBudget: 260,
    swatchClassName: "bg-sky-200",
  },
};

/** Note is the most "Pinwall" of the four and the default for a new
 *  templated text post — see TextPostEditor.tsx. */
export const DEFAULT_TEXT_TEMPLATE: TextTemplateId = "note";
