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
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
          {icon}
        </div>
      )}
      <p className="text-base font-semibold text-h1">{title}</p>
      {children && <p className="mt-1.5 max-w-md text-sm text-meta">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
