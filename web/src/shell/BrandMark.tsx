/** Marca AETHER-Ω: logo real (Ω+ב) para chrome y avatar del asistente. */

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
  /** `mark` = emblem; `avatar` = círculo para mensajes del asistente. */
  variant?: "mark" | "avatar" | "rail";
}) {
  const rounded = variant === "avatar" || variant === "rail";
  return (
    <img
      className={`brand-mark brand-mark-${variant} ${className}`.trim()}
      src={LOGO_SRC}
      width={size}
      height={size}
      alt={title}
      title={title}
      draggable={false}
      style={
        rounded
          ? {
              width: size,
              height: size,
              objectFit: "cover",
              borderRadius: variant === "avatar" ? "50%" : 8,
              flexShrink: 0,
            }
          : { width: size, height: size, objectFit: "contain", flexShrink: 0 }
      }
    />
  );
}
