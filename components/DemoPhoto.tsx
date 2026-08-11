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
  /** Background shown behind the photo — visible as letterbox bars when
   *  fit="contain", or briefly while the image loads. Defaults to a neutral
   *  placeholder gray; pass the surrounding page's own background so
   *  letterboxing blends in instead of reading as a distinct gray box. */
  placeholderClassName?: string;
};

export default function DemoPhoto({
  src,
  alt,
  className = "",
  style,
  fit = "cover",
  placeholderClassName = "bg-stone-200",
}: DemoPhotoProps) {
  return (
    <div
      role="img"
      aria-label={alt}
      className={`${placeholderClassName} bg-center ${fit === "contain" ? "bg-contain bg-no-repeat" : "bg-cover"} ${className}`}
      style={{ backgroundImage: `url("${src}")`, ...style }}
    />
  );
}
