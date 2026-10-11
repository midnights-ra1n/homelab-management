import type { ReactNode } from "react";
import { TONE_VAR, type Tone } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Tr } from "@/i18n/client";

const KINDS = {
  success: { tone: "green", glyph: "✓", title: "Succès" },
  warning: { tone: "yellow", glyph: "!", title: "Avertissement" },
  error: { tone: "red", glyph: "✕", title: "Erreur" },
  info: { tone: "blue", glyph: "i", title: "Information" },
} satisfies Record<string, { tone: Tone; glyph: string; title: string }>;

/** Message : icône + titre + texte, jamais la couleur seule. */
export function Alert({
  kind = "info",
  title,
  children,
  className,
  action,
}: {
  kind?: keyof typeof KINDS;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const k = KINDS[kind];
  const color = TONE_VAR[k.tone];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn("rise flex items-start gap-3 rounded-2xl border p-4", className)}
      style={{
        background: `color-mix(in srgb, ${color} 9%, var(--mm-bg-box))`,
        borderColor: `color-mix(in srgb, ${color} 40%, var(--mm-border))`,
      }}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold"
        style={{ background: color, color: "var(--mm-bg-box)" }}
      >
        {k.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold" style={{ color }}>
          {/* Composant partagé serveur / client : les messages venus des actions sont traduits ici. */}
          {typeof (title ?? k.title) === "string" ? <Tr>{(title ?? k.title) as string}</Tr> : title}
        </p>
        {children && <div className="mt-0.5 text-sm text-h2">{typeof children === "string" ? <Tr>{children}</Tr> : children}</div>}
      </div>
      {action}
    </div>
  );
}
