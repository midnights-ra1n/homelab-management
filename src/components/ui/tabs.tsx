import Link from "next/link";
import { cn } from "@/lib/utils";

/** Contrôle segmenté de la charte (.mm-segmented), piloté par l'URL. */
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
      className={cn("mm-segmented max-w-full overflow-x-auto", className)}
    >
      {items.map((item) => {
        const isActive = item.value === active;
        return (
          <Link
            key={item.value}
            href={item.href}
            scroll={false}
            aria-current={isActive ? "page" : undefined}
            className="mm-segmented__item shrink-0 gap-1.5 no-underline"
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
