import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Carte de la charte (.mm-card) : surface, bordure 1 px, rayon 10, sans ombre. */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mm-card", className)} {...props} />;
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
    <div className={cn("mm-card__head flex-wrap", className)}>
      <div className="min-w-0">
        {overline && <p className="mm-label-caps">{overline}</p>}
        <h3 className="mm-card__title truncate">{title}</h3>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mm-card__body", className)} {...props} />;
}

/** Label de section en capitales (.mm-label-caps). */
export function Overline({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("mm-label-caps", className)} {...props} />;
}
