import type { ReactNode } from "react";
import { TONE_TEXT_VAR, TONE_VAR, type Tone } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** Badge de statut (.mm-badge, pilule) : la couleur n'est jamais seule, toujours accompagnée d'un libellé. */
export function Badge({
  tone = "muted",
  children,
  className,
  icon,
  dot,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "mm-badge",
        className,
      )}
      style={
        tone === "muted"
          ? undefined
          : { color: TONE_TEXT_VAR[tone], background: `color-mix(in srgb, ${TONE_VAR[tone]} 16%, transparent)` }
      }
    >
      {dot && <span className="mm-badge__dot" style={{ background: TONE_VAR[tone] }} />}
      {icon}
      {children}
    </span>
  );
}

/** Étiquette libre (tags) : mono, pilule neutre. */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full bg-muted px-2 font-mono text-[0.7rem] text-body",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Pastille d'état, avec onde « ping » optionnelle comme sur la charte. */
export function StatusDot({ tone, ping, className }: { tone: Tone; ping?: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-flex h-2.5 w-2.5 shrink-0", className)} aria-hidden="true">
      {ping && <span className="ping absolute inset-0 rounded-full" style={{ background: TONE_VAR[tone] }} />}
      <span className="relative h-2.5 w-2.5 rounded-full" style={{ background: TONE_VAR[tone] }} />
    </span>
  );
}
