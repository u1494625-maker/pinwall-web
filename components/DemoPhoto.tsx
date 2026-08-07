import type { CSSProperties } from "react";

type DemoPhotoProps = {
  src: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
};

export default function DemoPhoto({ src, alt, className = "", style }: DemoPhotoProps) {
  return (
    <div
      role="img"
      aria-label={alt}
      className={`bg-stone-200 bg-cover bg-center ${className}`}
      style={{ backgroundImage: `url("${src}")`, ...style }}
    />
  );
}
