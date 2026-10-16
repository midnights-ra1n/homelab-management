import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mm-card mm-empty justify-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-body">
          {icon}
        </div>
      )}
      <p className="mm-empty__title">{title}</p>
      {children && <p className="mm-empty__msg">{children}</p>}
      {action && <div>{action}</div>}
    </div>
  );
}
