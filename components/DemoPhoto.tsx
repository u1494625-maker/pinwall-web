import type { CSSProperties } from "react";

type DemoPhotoProps = {
  src: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  /** "cover" (default, crops to fill — every existing caller) or "contain"
   *  (letterboxes instead of cropping — used by PostMediaGallery so swiping
   *  between differently-shaped photos never distorts or crops one to fit
   *  another's frame). */
  fit?: "cover" | "contain";
};

export default function DemoPhoto({ src, alt, className = "", style, fit = "cover" }: DemoPhotoProps) {
  return (
    <div
      role="img"
      aria-label={alt}
      className={`bg-stone-200 bg-center ${fit === "contain" ? "bg-contain bg-no-repeat" : "bg-cover"} ${className}`}
      style={{ backgroundImage: `url("${src}")`, ...style }}
    />
  );
}
