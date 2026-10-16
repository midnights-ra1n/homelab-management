import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Tuile KPI de la charte (.mm-stat) : libellé, valeur 28/600 tabulaire, détail. */
export function Stat({
  label,
  value,
  detail,
  icon,
  href,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  href?: string;
  tone?: "accent" | "red" | "yellow" | "green";
  className?: string;
}) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="mm-stat__label min-w-0 line-clamp-2 text-pretty">{label}</p>
        {icon && (
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
              tone === "red"
                ? "bg-red/12 text-red"
                : tone === "yellow"
                  ? "bg-yellow/12 text-yellow"
                  : tone === "green"
                    ? "bg-green/12 text-green"
                    : "bg-accent-soft text-accent-text",
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="mm-stat__value">{value}</p>
      {detail && <p className="mm-stat__meta line-clamp-2">{detail}</p>}
    </>
  );
  const cls = cn(
    "mm-card mm-stat transition-colors duration-[120ms]",
    href && "hover:border-line-strong",
    className,
  );
  return href ? (
    <Link href={href} className={cls}>
      {content}
    </Link>
  ) : (
    <div className={cls}>{content}</div>
  );
}
