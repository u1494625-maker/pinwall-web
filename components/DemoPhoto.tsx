type DemoPhotoProps = {
  src: string;
  alt: string;
  className?: string;
};

export default function DemoPhoto({ src, alt, className = "" }: DemoPhotoProps) {
  return (
    <div
      role="img"
      aria-label={alt}
      className={`bg-stone-200 bg-cover bg-center ${className}`}
      style={{ backgroundImage: `url("${src}")` }}
    />
  );
}
