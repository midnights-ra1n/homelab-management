"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { dateFormat, formatBytes } from "@/lib/utils";
import { useT } from "@/i18n/client";

export type RrdFormat = "pct" | "bytes" | "rate" | "num";

const W = 600;
const H = 140;

/** Courbe d'une série RRD Proxmox : trait 2 px, grille horizontale, réticule + infobulle au survol. */
export function RrdChart({
  title,
  times,
  values,
  format,
  max,
}: {
  title: string;
  times: number[];
  values: (number | null)[];
  format: RrdFormat;
  /** Échelle fixe (ex. 1 pour un pourcentage) ; sinon le maximum de la série. */
  max?: number;
}) {
  const tr = useT();
  const [hover, setHover] = useState<number | null>(null);
  const fmt = (v: number | null) => {
    if (v == null) return "—";
    if (format === "pct") return `${(v * 100).toFixed(1)} %`;
    if (format === "bytes") return formatBytes(v, tr.locale);
    if (format === "rate") return `${formatBytes(v, tr.locale)}/s`;
    return v.toFixed(2);
  };
  const top = max ?? (Math.max(...values.map((v) => v ?? 0), 0) * 1.1 || 1);
  const n = values.length;
  const x = (idx: number) => (n > 1 ? (idx / (n - 1)) * W : 0);
  const y = (v: number) => H - (v / top) * H;
  // Trous (null) : on coupe la ligne au lieu d'interpoler
  const d = values.reduce((acc, v, idx) => (v == null ? acc : `${acc}${idx === 0 || values[idx - 1] == null ? "M" : "L"}${x(idx).toFixed(1)},${y(v).toFixed(1)}`), "");
  const last = [...values].reverse().find((v) => v != null) ?? null;
  const time = dateFormat(tr.locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-h1">{title}</h3>
        <span className="font-mono text-sm tabular-nums text-h2">{fmt(hover != null ? values[hover] : last)}</span>
      </div>
      <div
        className="relative"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.min(n - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-32 w-full overflow-visible" role="img" aria-label={`${title} : ${fmt(last)}`}>
          {[0, 0.5, 1].map((f) => (
            <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="var(--mm-border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          <path d={d} fill="none" stroke="var(--mm-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--mm-border-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        </svg>
        <span className="pointer-events-none absolute left-1 top-0 font-mono text-[0.7rem] tabular-nums text-meta">{fmt(top)}</span>
        {hover != null && times[hover] && (
          <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-elevated px-1.5 py-0.5 font-mono text-[0.7rem] text-body">
            {time.format(new Date(times[hover] * 1000))}
          </span>
        )}
      </div>
    </Card>
  );
}
