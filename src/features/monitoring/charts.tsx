"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TONE_VAR } from "@/lib/constants";
import { cn, dateFormat } from "@/lib/utils";
import { uptimeTone, formatPct } from "@/lib/monitor/format";
import { useT } from "@/i18n/client";
import type { Locale } from "@/i18n/locales";
import type { Translate } from "@/i18n/translate";

export { uptimeTone, formatPct, formatDuration } from "@/lib/monitor/format";

/* --------------------------------------------------------------------------
 * Utilitaires
 * ------------------------------------------------------------------------ */

const noop = () => () => {};
/** Les dates sont formatées dans le fuseau du navigateur : rendu côté client uniquement. */
function useIsClient() {
  return useSyncExternalStore(noop, () => true, () => false);
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Pas « rond » (1, 2, 5 × 10ⁿ) donnant ~4 graduations. */
function niceScale(v: number) {
  const raw = Math.max(v, 1) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  const max = Math.ceil(Math.max(v, 1) / step) * step;
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step) };
}



const timeFmt = (l: Locale) => dateFormat(l, { hour: "2-digit", minute: "2-digit" });
const dayFmt = (l: Locale) => dateFormat(l, { day: "2-digit", month: "short" });
const weekdayFmt = (l: Locale) => dateFormat(l, { weekday: "short" });
const fullFmt = (l: Locale) => dateFormat(l, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/* --------------------------------------------------------------------------
 * Graphique de temps de réponse (ligne + aire, crosshair, bandes d'incident)
 * ------------------------------------------------------------------------ */

export type ChartPoint = { t: number; ms: number | null; checks: number; ups: number };

export function ResponseChart({
  points,
  from,
  to,
  bucketMs,
  height = 240,
  label = "Temps de réponse",
}: {
  points: ChartPoint[];
  from: number;
  to: number;
  bucketMs: number;
  height?: number;
  label?: string;
}) {
  const tr = useT();
  label = tr(label);
  const isClient = useIsClient();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const pad = { top: 12, right: 12, bottom: 26, left: 48 };
  const w = Math.max(width, 200);
  const innerW = w - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const scale = niceScale(Math.max(0, ...points.map((p) => p.ms ?? 0)) * 1.05);
  const max = scale.max;
  const x = (t: number) => pad.left + ((t + bucketMs / 2 - from) / (to - from)) * innerW;
  const y = (ms: number) => pad.top + innerH - (ms / max) * innerH;

  // Segments continus (on coupe la ligne là où il n'y a pas de mesure)
  const segments: ChartPoint[][] = [];
  let cur: ChartPoint[] = [];
  points.forEach((p, i) => {
    const gap = i > 0 && p.t - points[i - 1].t > bucketMs * 1.5;
    if (p.ms === null || gap) {
      if (cur.length) segments.push(cur);
      cur = [];
    }
    if (p.ms !== null) cur.push(p);
  });
  if (cur.length) segments.push(cur);

  const linePath = (seg: ChartPoint[]) => seg.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.ms!).toFixed(1)}`).join("");
  const areaPath = (seg: ChartPoint[]) =>
    `${linePath(seg)}L${x(seg[seg.length - 1].t).toFixed(1)},${pad.top + innerH}L${x(seg[0].t).toFixed(1)},${pad.top + innerH}Z`;

  const yTicks = scale.ticks;
  const span = to - from;
  const xTickCount = Math.max(2, Math.min(7, Math.floor(innerW / 110)));
  const xTicks = Array.from({ length: xTickCount }, (_, i) => from + (span * i) / (xTickCount - 1));
  const fmtTick = (t: number) => {
    if (span > 2 * 86_400_000) return dayFmt(tr.locale).format(t);
    const sameDay = new Date(t).toDateString() === new Date(to).toDateString();
    return sameDay ? timeFmt(tr.locale).format(t) : `${weekdayFmt(tr.locale).format(t)} ${timeFmt(tr.locale).format(t)}`;
  };

  const hp = hover !== null ? points[hover] : null;
  const avg = (() => {
    const v = points.filter((p) => p.ms !== null);
    return v.length ? Math.round(v.reduce((a, p) => a + p.ms!, 0) / v.length) : null;
  })();

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {isClient && width > 0 && (
        <>
          <svg
            width={w}
            height={height}
            role="img"
            aria-label={tr("{label} : moyenne {1} ms sur la période, {length} tranche(s) avec échec", { label: label, "1": avg ?? "—", length: points.filter((p) => p.ups < p.checks).length })}
            className="block overflow-visible"
          >
            {/* Grille horizontale + graduations */}
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={pad.left} x2={w - pad.right} y1={y(v)} y2={y(v)} stroke="var(--mm-border-subtle)" strokeWidth={1} />
                <text x={pad.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-meta font-mono text-[10px] tabular-nums">
                  {v} {tr("ms")}</text>
              </g>
            ))}
            {xTicks.map((t, i) => (
              <text
                key={t}
                x={pad.left + (innerW * i) / (xTickCount - 1)}
                y={height - 6}
                textAnchor={i === 0 ? "start" : i === xTickCount - 1 ? "end" : "middle"}
                className="fill-meta font-mono text-[10px]"
              >
                {fmtTick(t)}
              </text>
            ))}

            {/* Périodes en échec : bande rouge pâle + trait au pied */}
            {points
              .filter((p) => p.ups < p.checks)
              .map((p) => {
                const bw = Math.max(2, (bucketMs / span) * innerW);
                const x0 = pad.left + ((p.t - from) / span) * innerW;
                const severe = p.ups === 0;
                return (
                  <g key={`d${p.t}`}>
                    <rect x={x0} y={pad.top} width={bw} height={innerH} fill="var(--mm-red)" opacity={severe ? 0.14 : 0.07} />
                    <rect x={x0} y={pad.top + innerH - 3} width={bw} height={3} rx={1} fill="var(--mm-red)" />
                  </g>
                );
              })}

            {/* Aire + ligne */}
            {segments.map((seg, i) => (
              <g key={i}>
                {seg.length > 1 && <path d={areaPath(seg)} fill="var(--mm-accent)" opacity={0.1} />}
                <path d={linePath(seg)} fill="none" stroke="var(--mm-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {seg.length === 1 && <circle cx={x(seg[0].t)} cy={y(seg[0].ms!)} r={2.5} fill="var(--mm-accent)" />}
              </g>
            ))}

            {/* Crosshair */}
            {hp && (
              <g pointerEvents="none">
                <line x1={x(hp.t)} x2={x(hp.t)} y1={pad.top} y2={pad.top + innerH} stroke="var(--mm-border-strong)" strokeWidth={1} />
                {hp.ms !== null && (
                  <circle cx={x(hp.t)} cy={y(hp.ms)} r={4} fill="var(--mm-accent)" stroke="var(--mm-bg-box)" strokeWidth={2} />
                )}
              </g>
            )}

            {/* Zone de survol */}
            <rect
              x={pad.left}
              y={pad.top}
              width={innerW}
              height={innerH}
              fill="transparent"
              onPointerMove={(e) => {
                const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
                const t = from + ((e.clientX - rect.left) / rect.width) * span;
                let best = -1;
                let bestD = Infinity;
                points.forEach((p, i) => {
                  const d = Math.abs(p.t + bucketMs / 2 - t);
                  if (d < bestD) {
                    bestD = d;
                    best = i;
                  }
                });
                setHover(best >= 0 && bestD <= bucketMs * 2 ? best : null);
              }}
              onPointerLeave={() => setHover(null)}
            />
          </svg>

          {hp && (
            <div
              className="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 rounded-xl border border-line bg-elevated px-3 py-2 shadow-[var(--mm-shadow-popover)]"
              style={{
                left: Math.min(Math.max(x(hp.t), pad.left + 72), w - 72),
                top: 0,
              }}
            >
              <p className="text-base font-semibold text-h1 tabular-nums">{hp.ms !== null ? `${hp.ms} ms` : "—"}</p>
              <p className="text-xs text-meta">{fullFmt(tr.locale).format(hp.t)}</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-body">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: hp.ups === hp.checks ? TONE_VAR.green : hp.ups === 0 ? TONE_VAR.red : TONE_VAR.yellow }}
                  aria-hidden
                />
                {hp.ups === hp.checks ? tr("Disponible") : hp.ups === 0 ? tr("Indisponible") : tr("Partiellement disponible")} · {hp.ups}/{hp.checks}
              </p>
            </div>
          )}
        </>
      )}
      {(!isClient || width === 0) && <div className="skeleton h-full w-full rounded-xl bg-elevated/50" />}
      {isClient && width > 0 && points.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-meta">{tr("Pas encore de mesure sur cette période")}</p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Barres de disponibilité (90 jours façon status page)
 * ------------------------------------------------------------------------ */

export type DayBar = { day: string; checks: number; uptime: number | null; avg: number | null };

export function UptimeBars({ days: allDays, height = 32, className }: { days: DayBar[]; height?: number; className?: string }) {
  const tr = useT();
  const isClient = useIsClient();
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  // Écran étroit : on garde les N derniers jours qui tiennent (≥ 3 px par barre + 2 px d'écart)
  const fit = width > 0 ? Math.max(14, Math.floor((width + 2) / 5)) : allDays.length;
  const days = allDays.slice(-Math.min(fit, allDays.length));
  const known = days.filter((d) => d.uptime !== null);
  const bad = known.filter((d) => (d.uptime ?? 100) < 99.9).length;
  const h = hover !== null ? days[hover] : null;
  return (
    <div ref={ref} className={cn("relative", className)}>
      <div
        className="flex items-end gap-[2px]"
        style={{ height }}
        role="img"
        aria-label={tr("Disponibilité sur {length} jours : {1} jour(s) mesuré(s), {bad} jour(s) dégradé(s)", { length: days.length, "1": known.length, bad: bad })}
        onPointerLeave={() => setHover(null)}
      >
        {days.map((d, i) => {
          const tone = uptimeTone(d.uptime);
          return (
            <span
              key={d.day}
              onPointerEnter={() => setHover(i)}
              className={cn("h-full min-w-[2px] flex-1 rounded-[2px] transition-opacity", hover !== null && hover !== i && "opacity-60")}
              style={{ background: tone ? TONE_VAR[tone] : "var(--mm-border-subtle)" }}
            />
          );
        })}
      </div>
      {h && isClient && (
        <div
          className="pointer-events-none absolute bottom-[calc(100%+8px)] z-10 min-w-40 -translate-x-1/2 rounded-xl border border-line bg-elevated px-3 py-2 shadow-[var(--mm-shadow-popover)]"
          style={{ left: `clamp(5rem, ${((hover! + 0.5) / days.length) * 100}%, calc(100% - 5rem))` }}
        >
          <p className="text-xs text-meta">{dateFormat(tr.locale, { weekday: "long", day: "numeric", month: "long" }).format(new Date(h.day))}</p>
          {h.uptime === null ? (
            <p className="text-sm text-body">{tr("Aucune mesure")}</p>
          ) : (
            <>
              <p className="text-base font-semibold text-h1">{formatPct(h.uptime, 2, tr.locale)}</p>
              <p className="text-xs text-body">
                {h.checks} {tr("contrôle(s)")}{h.avg !== null ? tr(" · {avg} ms en moyenne", { avg: h.avg }) : ""}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Mini-courbe (liste des sondes)
 * ------------------------------------------------------------------------ */

export function Sparkline({ values, down, className }: { values: (number | null)[]; down: boolean[]; className?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const h = 32;
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const n = values.length;
  const x = (i: number) => (n <= 1 ? width : (i / (n - 1)) * (width - 4) + 2);
  const y = (v: number) => h - 3 - (v / max) * (h - 8);
  let d = "";
  values.forEach((v, i) => {
    if (v === null) return;
    d += `${d && values[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  const lastIdx = values.map((v, i) => (v !== null ? i : -1)).filter((i) => i >= 0).pop();
  return (
    <div ref={ref} className={cn("h-8 w-full", className)} aria-hidden>
      {width > 0 && (
        <svg width={width} height={h} className="block overflow-visible">
          {down.map((isDown, i) => (isDown ? <rect key={i} x={x(i) - 1.5} y={h - 3} width={3} height={3} rx={1} fill="var(--mm-red)" /> : null))}
          <path d={d} fill="none" stroke="var(--mm-accent)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
          {lastIdx !== undefined && (
            <circle cx={x(lastIdx)} cy={y(values[lastIdx]!)} r={3} fill="var(--mm-accent)" stroke="var(--mm-bg-box)" strokeWidth={2} />
          )}
        </svg>
      )}
    </div>
  );
}

function relative(ts: number, tr: Translate) {
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60 ? tr("il y a {s} s", { s }) : s < 3600 ? tr("il y a {m} min", { m: Math.round(s / 60) }) : fullFmt(tr.locale).format(ts);
}

/** Date/heure formatée dans le fuseau du navigateur. */
export function LocalTime({ ts, mode = "full" }: { ts: number; mode?: "full" | "time" | "relative" }) {
  const isClient = useIsClient();
  const tr = useT();
  if (!isClient) return <span className="opacity-0">…</span>;
  if (mode === "time") return <>{timeFmt(tr.locale).format(ts)}</>;
  if (mode === "relative") return <>{relative(ts, tr)}</>;
  return <>{fullFmt(tr.locale).format(ts)}</>;
}

