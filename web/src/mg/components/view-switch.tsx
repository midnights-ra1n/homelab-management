
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

/** Bascule de vue (pilule) ; le choix est mémorisé un an dans un cookie. */
export function ViewSwitch({
  name,
  value,
  options,
}: {
  name: string;
  value: string;
  options: { value: string; label: string; icon: ReactNode; href: string }[];
}) {
  const tr = useT();
  return (
    <nav aria-label={tr("Affichage")} className="inline-flex items-center gap-1 rounded-full border border-line bg-box p-1">
      {options.map((o) => (
        <Link
          key={o.value}
          href={o.href}
          scroll={false}
          aria-current={value === o.value ? "page" : undefined}
          onClick={() => {
            document.cookie = `hm-view-${name}=${o.value}; path=/; max-age=31536000; samesite=lax`;
          }}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-mono text-xs transition-colors",
            value === o.value ? "bg-accent text-on-accent" : "text-body hover:text-h1",
          )}
        >
          {o.icon} {o.label}
        </Link>
      ))}
    </nav>
  );
}
