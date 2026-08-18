export type TextTemplateId = "note" | "quote" | "memo" | "basic";

export type TextTemplateConfig = {
  id: TextTemplateId;
  label: string;
  /** Solid background swatch for the template-picker button — matches each
   *  template's own outer card background. */
  swatchClassName: string;
};

export const TEXT_TEMPLATE_IDS: TextTemplateId[] = ["note", "quote", "memo", "basic"];

export const TEXT_TEMPLATES: Record<TextTemplateId, TextTemplateConfig> = {
  note: {
    id: "note",
    label: "Note",
    swatchClassName: "bg-amber-400",
  },
  quote: {
    id: "quote",
    label: "Quote",
    swatchClassName: "bg-[#f3ead9]",
  },
  memo: {
    id: "memo",
    label: "Memo",
    swatchClassName: "border border-stone-200 bg-white",
  },
  basic: {
    id: "basic",
    label: "Basic",
    swatchClassName: "bg-sky-200",
  },
};

/** Note is the most "Pinwall" of the four and the default for a new
 *  templated text post — see TextPostEditor.tsx. */
export const DEFAULT_TEXT_TEMPLATE: TextTemplateId = "note";
