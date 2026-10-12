import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Tuile KPI : valeur bright en grand, libellé muted, détail mono. */
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
        <p className="min-w-0 truncate text-[0.8rem] text-body sm:text-sm">{label}</p>
        {icon && (
          <span
            className={cn(
              "hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:flex",
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
      <p className="mt-2 text-2xl font-bold tracking-tight text-h1 tabular-nums sm:mt-3 sm:text-3xl">{value}</p>
      {detail && <p className="mt-1 truncate text-xs text-meta mint:font-mono">{detail}</p>}
    </>
  );
  const cls = cn(
    "block min-w-0 rounded-xl border border-line-subtle bg-box p-5 transition-colors duration-200 sm:p-7 mint:rounded-2xl mint:p-4 mint:sm:p-6",
    href && "hover:border-line-accent",
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
