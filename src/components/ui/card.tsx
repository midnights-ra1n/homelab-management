import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Carte : teinte surface, séparateur subtil, arrondi 2xl. */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-xl border border-line-subtle bg-box mint:rounded-2xl", className)} {...props} />;
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
    <div className={cn("flex flex-wrap items-start justify-between gap-4 px-6 pt-6 sm:px-8 sm:pt-8 mint:sm:px-7 mint:sm:pt-7", className)}>
      <div className="min-w-0">
        {overline && <p className="text-xs font-medium text-meta mint:font-mono mint:text-[0.7rem] mint:font-normal mint:uppercase mint:tracking-[0.18em]">{overline}</p>}
        <h3 className={cn("truncate text-base font-semibold text-h1", !!overline && "mt-1")}>{title}</h3>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-6 sm:p-8 mint:p-5 mint:sm:p-7", className)} {...props} />;
}

/** Surtitre mono majuscule (Palette · v1.0). */
export function Overline({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-sm font-medium text-meta mint:font-mono mint:text-xs mint:font-normal mint:uppercase mint:tracking-[0.18em]", className)} {...props} />;
}
