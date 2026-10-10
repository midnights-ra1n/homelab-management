import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Carte : teinte surface, séparateur subtil, arrondi 2xl. */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-2xl border border-line-subtle bg-box", className)} {...props} />;
}

export function CardHeader({
  title,
  overline,
  actions,
  className,
}: {
  title: ReactNode;
  overline?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4 px-5 pt-5 sm:px-7 sm:pt-7", className)}>
      <div className="min-w-0">
        {overline && <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-meta">{overline}</p>}
        <h3 className={cn("truncate text-base font-semibold text-h1", !!overline && "mt-1")}>{title}</h3>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-5 sm:p-7", className)} {...props} />;
}

/** Surtitre mono majuscule (Palette · v1.0). */
export function Overline({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("font-mono text-xs uppercase tracking-[0.18em] text-meta", className)} {...props} />;
}
