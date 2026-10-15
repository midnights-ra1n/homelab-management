import { TONE_VAR, type Tone } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function meterTone(value: number): Tone {
  if (value >= 90) return "red";
  if (value >= 75) return "yellow";
  return "accent";
}

/** Jauge horizontale ; la teinte suit les seuils (75 % / 90 %) sauf si imposée. */
export function Meter({
  value,
  label,
  detail,
  tone,
  className,
  size = "md",
}: {
  value: number | null | undefined;
  label?: string;
  detail?: string;
  tone?: Tone;
  className?: string;
  size?: "sm" | "md";
}) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const t = tone ?? meterTone(v);
  return (
    <div className={cn("min-w-0", className)}>
      {(label || detail) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
          <span className="truncate text-body">{label}</span>
          <span className="shrink-0 text-meta tabular-nums">{detail ?? (value == null ? "—" : `${Math.round(v)} %`)}</span>
        </div>
      )}
      <div
        className={cn("overflow-hidden rounded-full bg-muted", size === "md" ? "h-2" : "h-1.5")}
        role="meter"
        aria-valuenow={Math.round(v)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-full transition-[width] duration-[260ms] ease-[var(--ease-expo)]"
          style={{ width: `${v}%`, background: TONE_VAR[t] }}
        />
      </div>
    </div>
  );
}
