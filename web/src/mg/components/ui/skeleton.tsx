import { use } from "react";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";
import { Skeleton } from "../../../ui";

export { Skeleton };

export function SkeletonGrid({ count = 6, className }: { count?: number; className?: string }) {
  const tr = use(getT());
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", className)} aria-busy="true" aria-label={tr("Chargement")}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-36 rounded-2xl" />
      ))}
    </div>
  );
}
