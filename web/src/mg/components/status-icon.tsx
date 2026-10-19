import { CircleAlert, CircleCheck, CirclePause, Clock, TriangleAlert, Wrench } from "lucide-react";
import { TONE_VAR } from "@/lib/constants";
import { cn } from "@/lib/utils";

export type StatusKind = "ok" | "warn" | "down" | "pending" | "paused" | "maintenance";

const META = {
  ok: { Icon: CircleCheck, tone: TONE_VAR.green },
  warn: { Icon: TriangleAlert, tone: TONE_VAR.yellow },
  down: { Icon: CircleAlert, tone: TONE_VAR.red },
  pending: { Icon: Clock, tone: TONE_VAR.blue },
  paused: { Icon: CirclePause, tone: TONE_VAR.muted },
  maintenance: { Icon: Wrench, tone: TONE_VAR.blue },
} as const;

/** Statut d'un hôte / d'une sonde du hub Midnights Monitoring. */
export function hlmKind(status: string, opts: { enabled?: boolean; maintenance?: boolean } = {}): StatusKind {
  if (opts.enabled === false) return "paused";
  if (opts.maintenance || status === "maintenance") return "maintenance";
  if (status === "operational") return "ok";
  if (status === "degraded") return "warn";
  if (status === "unknown") return "pending";
  return "down";
}

export const statusTone = (kind: StatusKind) => META[kind].tone;

/** Icône d'état (✓ opérationnel, ⚠ dégradé, ! en panne…) dans la teinte correspondante. */
export function StatusIcon({ kind, size = 16, className, label }: { kind: StatusKind; size?: number; className?: string; label?: string }) {
  const { Icon, tone } = META[kind];
  return (
    <Icon
      size={size}
      strokeWidth={2.25}
      className={cn("shrink-0", className)}
      style={{ color: tone }}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
    />
  );
}
