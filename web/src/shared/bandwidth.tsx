/* Bandwidth figures and chart, shown identically by the monitoring (page and dashboard) and the
   management dashboards, from the same GET /api(/v1)/bandwidth view. */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ShieldCheck } from "lucide-react";
import { fmtMbps, fmtOctets, type BandwidthLink } from "../api";
import { Chart, StatusIcon, cn, statusKind } from "../ui";

/** Current, average and peak rates of one interface, its traffic volume, plus its link state. */
export function BandwidthFigures({ l, compact }: { l: BandwidthLink; compact?: boolean }) {
  const side = (label: string, icon: React.ReactNode, s: BandwidthLink["in"]) => s && (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-xs text-meta">{icon}{label}</p>
      <p className={cn("font-mono font-semibold tabular-nums text-h1", compact ? "text-lg" : "text-2xl")}>{fmtMbps(s.current_mbps)}</p>
      {!compact && <p className="font-mono text-xs text-meta">moy. {fmtMbps(s.avg_mbps)} · pic {fmtMbps(s.peak_mbps)}</p>}
      <p className="font-mono text-xs text-meta">aujourd'hui {fmtOctets(s.today_octets)}{!compact && <> · ce mois {fmtOctets(s.month_octets)}</>}</p>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {side("Entrant", <ArrowDown size={13} aria-hidden />, l.in)}
      {side("Sortant", <ArrowUp size={13} aria-hidden />, l.out)}
      {l.state && (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs text-meta"><ShieldCheck size={13} aria-hidden />État</p>
          <p className="flex items-center gap-1.5 truncate text-sm text-h1" title={l.state.message}>
            <StatusIcon kind={statusKind(l.state.status)} size={14} /><span className="truncate">{l.state.message || l.state.name}</span>
          </p>
        </div>
      )}
    </div>
  );
}

/** Traffic volume per local day (last 31 days). */
export function BandwidthVolume({ days, l, height = 160 }: { days: number[]; l: BandwidthLink; height?: number }) {
  const series = useMemo(() => [
    ...(l.in ? [{ label: "Reçu", values: l.in.daily_octets }] : []),
    ...(l.out ? [{ label: "Envoyé", values: l.out.daily_octets }] : []),
  ], [l]);
  return <Chart t={days} series={series} format={fmtOctets} height={height} />;
}

export function BandwidthChart({ t, l, height = 220 }: { t: number[]; l: BandwidthLink; height?: number }) {
  const series = useMemo(() => [
    ...(l.in ? [{ label: "Entrant", values: l.in.series }] : []),
    ...(l.out ? [{ label: "Sortant", values: l.out.series }] : []),
  ], [l]);
  return <Chart t={t} series={series} format={fmtMbps} height={height} />;
}

/* ---------- Live view ---------- */

export interface LiveSample { monitor_id: number; mode: "in" | "out"; mbps: number | null; error?: string }
export interface LiveView { at: number; samples: LiveSample[] }
/** One live reading per hub; key tells hubs apart (their probe ids may collide). */
export type LiveSource = { key: string; view: LiveView };

export interface LiveState { t: number[]; values: Record<string, (number | null)[]>; last: Record<string, LiveSample>; error?: string }

const LIVE_EVERY_MS = 2000;
const LIVE_POINTS = 150; // 5 minutes

/** Polls the live rates every 2 s while mounted (paused in a hidden tab) and keeps a rolling 5-minute window. */
export function useLiveBandwidth(load: () => Promise<LiveSource[]>): LiveState {
  const [state, setState] = useState<LiveState>({ t: [], values: {}, last: {} });
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      if (!document.hidden) {
        try {
          const sources = await loadRef.current();
          if (!stopped) setState((prev) => appendLive(prev, sources));
        } catch (e) {
          if (!stopped) setState((prev) => ({ ...prev, error: (e as Error).message }));
        }
      }
      if (!stopped) timer = window.setTimeout(tick, LIVE_EVERY_MS);
    };
    tick();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, []);
  return state;
}

export function appendLive(prev: LiveState, sources: LiveSource[]): LiveState {
  const at = Math.max(0, ...sources.map((s) => Math.floor(s.view.at / 1000)));
  // The hub shares one reading between close requests: the same instant is not added twice.
  if (!sources.length || at <= (prev.t[prev.t.length - 1] ?? 0)) return { ...prev, error: undefined };
  const t = [...prev.t, at].slice(-LIVE_POINTS);
  const drop = prev.t.length + 1 - t.length;
  const last: Record<string, LiveSample> = {};
  const values: Record<string, (number | null)[]> = {};
  for (const s of sources) for (const smp of s.view.samples) last[`${s.key}:${smp.monitor_id}`] = smp;
  for (const k of new Set([...Object.keys(prev.values), ...Object.keys(last)])) {
    const old = prev.values[k] ?? Array<number | null>(prev.t.length).fill(null);
    values[k] = [...old, last[k]?.mbps ?? null].slice(drop);
  }
  return { t, values, last };
}

/** The link with its live rates in place of the stored ones, for BandwidthFigures / BandwidthChart. */
export function withLive(l: BandwidthLink, live: LiveState, key: string): BandwidthLink {
  const side = (s: BandwidthLink["in"]) => s && {
    ...s,
    current_mbps: live.last[`${key}:${s.monitor_id}`]?.mbps ?? null,
    series: live.values[`${key}:${s.monitor_id}`] ?? [],
  };
  return { ...l, in: side(l.in), out: side(l.out) };
}

/** Errors of the live reads of one link (device unreachable, interface missing…). */
export const liveErrors = (l: BandwidthLink, live: LiveState, key: string) =>
  [...new Set([l.in, l.out].map((s) => s && live.last[`${key}:${s.monitor_id}`]?.error).filter((e): e is string => !!e))];

/** Live figures and 5-minute chart of one link. */
export function LiveLink({ l, live, sourceKey, height = 180 }: { l: BandwidthLink; live: LiveState; sourceKey: string; height?: number }) {
  const shown = withLive(l, live, sourceKey);
  const errors = liveErrors(l, live, sourceKey);
  return (
    <>
      <BandwidthFigures l={shown} compact />
      {errors.map((e) => <p key={e} className="text-xs text-red">{e}</p>)}
      {(l.in || l.out) && <BandwidthChart t={live.t} l={shown} height={height} />}
    </>
  );
}
