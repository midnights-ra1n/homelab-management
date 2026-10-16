/* eslint-disable @next/next/no-img-element -- icônes externes / téléversées de tailles variées */
import { iconSrc } from "@/lib/icons";
import type { IconType } from "@/lib/data/shortcuts";
import { cn } from "@/lib/utils";

export function AppIcon({
  type,
  value,
  name,
  size = 40,
  className,
}: {
  type: IconType;
  value: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const src = iconSrc(type, value);
  if (!src) {
    return (
      <span
        className={cn("flex shrink-0 items-center justify-center rounded-xl bg-accent-soft font-semibold uppercase text-accent-text", className)}
        style={{ width: size, height: size, fontSize: size * 0.4 }}
        aria-hidden="true"
      >
        {name.slice(0, 2)}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className={cn("shrink-0 object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}
