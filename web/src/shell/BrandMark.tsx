/** Marca AETHER-Ω: mismo JPG del mockup (Ω+ב) para chrome y avatar. */

const LOGO_SRC = "/brand/aether-omega.jpg";

export default function BrandMark({
  size = 22,
  className = "",
  title = "AETHER-Ω",
  variant = "mark",
}: {
  size?: number;
  className?: string;
  title?: string;
  /** `mark` chrome; `avatar` círculo en chat; `rail` Activity. */
  variant?: "mark" | "avatar" | "rail";
}) {
  const radius = variant === "avatar" ? "50%" : 8;
  return (
    <img
      className={`brand-mark brand-mark-${variant} ${className}`.trim()}
      src={LOGO_SRC}
      width={size}
      height={size}
      alt={title}
      title={title}
      draggable={false}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: radius,
      }}
    />
  );
}
