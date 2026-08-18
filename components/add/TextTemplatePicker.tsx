"use client";

import TextPostVisual from "@/components/post/TextPostVisual";
import { TEXT_TEMPLATE_IDS, TEXT_TEMPLATES, type TextTemplateId } from "@/lib/textTemplates";

type TextTemplatePickerProps = {
  template: TextTemplateId;
  onTemplateChange: (template: TextTemplateId) => void;
  previewText: string;
};

/**
 * Large live preview — exactly the same TextPostVisual the feed/detail will
 * render, so preview is truth, nothing separate to keep in sync — plus a
 * horizontal row of 4 selectable template swatches. Tapping a swatch swaps
 * the preview immediately (pure state, no fetch). Long text's later pages
 * aren't shown here: every page always shares this one selected template
 * (see lib/textPagination.ts), so there's nothing page-2-specific to preview
 * before publishing.
 */
export default function TextTemplatePicker({ template, onTemplateChange, previewText }: TextTemplatePickerProps) {
  return (
    <div className="space-y-3">
      <TextPostVisual template={template} text={previewText || "Your text will look like this."} size="card" />

      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {TEXT_TEMPLATE_IDS.map((id) => {
          const config = TEXT_TEMPLATES[id];
          const isSelected = id === template;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onTemplateChange(id)}
              aria-pressed={isSelected}
              className={`flex shrink-0 flex-col items-center gap-1.5 rounded-xl p-1.5 ${
                isSelected ? "ring-2 ring-orange-500" : "ring-1 ring-stone-200"
              }`}
            >
              <span aria-hidden="true" className={`size-11 rounded-lg ${config.swatchClassName}`} />
              <span className={`text-xs font-semibold ${isSelected ? "text-orange-600" : "text-stone-500"}`}>
                {config.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
