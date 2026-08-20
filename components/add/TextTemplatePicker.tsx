"use client";

import TextPostVisual from "@/components/post/TextPostVisual";
import { TEXT_TEMPLATE_IDS, TEXT_TEMPLATES, type TextTemplateId } from "@/lib/textTemplates";

type TextTemplatePickerProps = {
  template: TextTemplateId;
  onTemplateChange: (template: TextTemplateId) => void;
  title: string;
};

/**
 * Large live preview — exactly the same TextPostVisual the feed/detail will
 * render, so preview is truth, nothing separate to keep in sync — plus a
 * horizontal row of 4 selectable template swatches. Tapping a swatch swaps
 * the preview immediately (pure state, no fetch). Previews the TITLE, not
 * the caption — the template is the post's visual cover, and a cover shows
 * the title, exactly like a photo cover shows the photo.
 */
export default function TextTemplatePicker({ template, onTemplateChange, title }: TextTemplatePickerProps) {
  return (
    <div className="space-y-3">
      <TextPostVisual template={template} text={title || "Your title will look like this."} size="card" />

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
                isSelected ? "ring-2 ring-kavanaka-lime" : "ring-1 ring-stone-200"
              }`}
            >
              <span aria-hidden="true" className={`size-11 rounded-lg ${config.swatchClassName}`} />
              <span className={`text-xs font-semibold ${isSelected ? "text-kavanaka-green" : "text-stone-500"}`}>
                {config.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
