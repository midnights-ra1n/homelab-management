import Link from "next/link";
import { cn } from "@/lib/utils";

/** Sélecteur segmenté en pilule (style du choix de thème de la charte), piloté par l'URL. */
export function LinkTabs({
  items,
  active,
  label,
  className,
}: {
  items: { value: string; label: string; href: string; count?: number }[];
  active: string;
  label: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn("inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-line bg-box p-1", className)}
    >
      {items.map((item) => {
        const isActive = item.value === active;
        return (
          <Link
            key={item.value}
            href={item.href}
            scroll={false}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 font-mono text-xs transition-colors duration-200",
              isActive ? "bg-accent text-on-accent" : "text-body hover:text-h1",
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className={cn("tabular-nums", isActive ? "opacity-70" : "text-meta")}>{item.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
