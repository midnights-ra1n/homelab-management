import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tr } from "@/i18n/client";

/** Charte : glyphe texte dans une pastille (✓ ! ✕ i) + titre + message, jamais la couleur seule. */
const KINDS = {
  success: { cls: "mm-alert--success", glyph: "✓", title: "Succès" },
  warning: { cls: "mm-alert--warning", glyph: "!", title: "Avertissement" },
  error: { cls: "mm-alert--danger", glyph: "✕", title: "Erreur" },
  info: { cls: "", glyph: "i", title: "Information" },
};

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
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cn("mm-alert items-start", k.cls, className)}>
      <span className="mm-alert__glyph" aria-hidden="true">
        {k.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <p className="mm-alert__title">
          {/* Composant partagé serveur / client : les messages venus des actions sont traduits ici. */}
          {typeof (title ?? k.title) === "string" ? <Tr>{(title ?? k.title) as string}</Tr> : title}
        </p>
        {children && <div className="mm-alert__msg">{typeof children === "string" ? <Tr>{children}</Tr> : children}</div>}
      </div>
      {action}
    </div>
  );
}
