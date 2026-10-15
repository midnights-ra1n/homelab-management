"use client";

import { ArrowUpDown, Cloud, Flame, Globe, Laptop, Network, Play, Router, Shield } from "lucide-react";
import { useState, useTransition } from "react";
import { simulateAction } from "@/actions/network";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/form";
import { TONE_VAR } from "@/lib/constants";
import type { HopKind, SimEndpoint, SimResult } from "@/lib/net/engine";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

type AssetOpt = { id: number; label: string; ip: string | null; group: string };

const HOP_ICON: Record<HopKind, typeof Laptop> = {
  host: Laptop,
  switch: Network,
  router: Router,
  firewall: Flame,
  vpn: Shield,
  internet: Globe,
};

const PORT_PRESETS = [
  { label: "SSH", port: 22 },
  { label: "DNS", port: 53 },
  { label: "HTTP", port: 80 },
  { label: "HTTPS", port: 443 },
  { label: "Proxmox", port: 8006 },
  { label: "SMB", port: 445 },
];

type Side = { mode: "asset" | "ip"; assetId: string; ip: string };

function toEndpoint(s: Side): SimEndpoint | null {
  if (s.mode === "asset") return s.assetId ? { kind: "asset", id: Number(s.assetId) } : null;
  return s.ip.trim() ? { kind: "ip", ip: s.ip.trim() } : null;
}

function EndpointPicker({ label, side, onChange, assets }: { label: string; side: Side; onChange: (s: Side) => void; assets: AssetOpt[] }) {
  const tr = useT();
  const groups = [...new Set(assets.map((a) => a.group))];
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium text-h1">{label}</legend>
      <div className="inline-flex w-fit items-center gap-1 rounded-full border border-line bg-page p-1">
        {(["asset", "ip"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange({ ...side, mode: m })}
            aria-pressed={side.mode === m}
            className={cn(
              "rounded-full px-3 py-1 font-mono text-xs transition-colors",
              side.mode === m ? "bg-accent text-on-accent" : "text-body hover:text-h1",
            )}
          >
            {m === "asset" ? tr("Élément") : tr("Adresse IP")}
          </button>
        ))}
      </div>
      {side.mode === "asset" ? (
        <select aria-label={label} className={inputClass} value={side.assetId} onChange={(e) => onChange({ ...side, assetId: e.target.value })}>
          <option value="">{tr("— Choisir —")}</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {assets
                .filter((a) => a.group === g)
                .map((a) => (
                  <option key={a.id} value={a.id} disabled={!a.ip}>
                    {a.label}
                    {a.ip ? ` · ${a.ip}` : tr(" · sans IP")}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      ) : (
        <input
          aria-label={`${label} (IP)`}
          className={cn(inputClass, "font-mono")}
          placeholder="192.168.20.15 · 1.1.1.1"
          value={side.ip}
          onChange={(e) => onChange({ ...side, ip: e.target.value })}
          inputMode="decimal"
        />
      )}
    </fieldset>
  );
}

/** Mode simulation « Packet Tracer » : suit un paquet saut par saut. */
export function Simulator({ assets }: { assets: AssetOpt[] }) {
  const tr = useT();
  const [src, setSrc] = useState<Side>({ mode: "asset", assetId: "", ip: "" });
  const [dst, setDst] = useState<Side>({ mode: "asset", assetId: "", ip: "" });
  const [protocol, setProtocol] = useState<"icmp" | "tcp" | "udp">("icmp");
  const [port, setPort] = useState("");
  const [result, setResult] = useState<SimResult | null>(null);
  const [run, setRun] = useState(0);
  const [pending, start] = useTransition();
  const [history, setHistory] = useState<{ label: string; ok: boolean; src: Side; dst: Side; protocol: typeof protocol; port: string }[]>([]);

  const send = (s = src, d = dst, p = protocol, pt = port) => {
    const a = toEndpoint(s);
    const b = toEndpoint(d);
    if (!a || !b) return;
    start(async () => {
      const r = await simulateAction({ src: a, dst: b, protocol: p, port: p === "icmp" ? null : Number(pt) || null });
      setResult(r);
      setRun((n) => n + 1);
      const name = (x: Side) => (x.mode === "asset" ? (assets.find((o) => String(o.id) === x.assetId)?.label ?? "?") : x.ip);
      setHistory((h) =>
        [{ label: `${name(s)} → ${name(d)} · ${p.toUpperCase()}${p !== "icmp" && pt ? `/${pt}` : ""}`, ok: r.ok, src: s, dst: d, protocol: p, port: pt }, ...h].slice(0, 6),
      );
    });
  };

  const stopIndex = result ? (result.hops.findIndex((h) => h.status === "fail") === -1 ? result.hops.length - 1 : result.hops.findIndex((h) => h.status === "fail")) : 0;

  return (
    <div className="grid gap-6 xl:grid-cols-[24rem_1fr] xl:gap-8">
      {/* Paramètres du paquet */}
      <div className="grid content-start gap-5 rounded-2xl border border-line-subtle bg-box p-5 sm:p-6">
        <EndpointPicker label={tr("Source")} side={src} onChange={setSrc} assets={assets} />
        <div className="flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowUpDown size={14} />}
            onClick={() => {
              setSrc(dst);
              setDst(src);
            }}
          >
            {tr("Inverser")}</Button>
        </div>
        <EndpointPicker label={tr("Destination")} side={dst} onChange={setDst} assets={assets} />

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-h1">{tr("Protocole")}</legend>
          <div className="inline-flex items-center gap-1 rounded-full border border-line bg-page p-1">
            {(["icmp", "tcp", "udp"] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={protocol === p}
                onClick={() => setProtocol(p)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 font-mono text-xs transition-colors",
                  protocol === p ? "bg-accent text-on-accent" : "text-body hover:text-h1",
                )}
              >
                {p === "icmp" ? tr("ICMP (ping)") : p.toUpperCase()}
              </button>
            ))}
          </div>
        </fieldset>

        {protocol !== "icmp" && (
          <div>
            <label htmlFor="sim-port" className="mb-2 block text-sm font-medium text-h1">
              {tr("Port de destination")}</label>
            <input
              id="sim-port"
              className={cn(inputClass, "font-mono")}
              inputMode="numeric"
              placeholder="443"
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PORT_PRESETS.map((p) => (
                <button
                  key={p.port}
                  type="button"
                  onClick={() => setPort(String(p.port))}
                  className={cn(
                    "rounded-full border px-2.5 py-1 font-mono text-[0.7rem] transition-colors",
                    port === String(p.port) ? "border-accent bg-accent-soft text-accent-text" : "border-line text-body hover:text-h1",
                  )}
                >
                  {p.label} {p.port}
                </button>
              ))}
            </div>
          </div>
        )}

        <Button
          className="w-full"
          disabled={pending || !toEndpoint(src) || !toEndpoint(dst)}
          onClick={() => send()}
          icon={<Play size={15} />}
        >
          {pending ? tr("Simulation…") : tr("Envoyer le paquet")}
        </Button>

        {history.length > 0 && (
          <div>
            <p className="mb-2 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">{tr("Scénarios récents")}</p>
            <ul className="grid gap-1">
              {history.map((h, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => {
                      setSrc(h.src);
                      setDst(h.dst);
                      setProtocol(h.protocol);
                      setPort(h.port);
                      send(h.src, h.dst, h.protocol, h.port);
                    }}
                    className="flex w-full items-center gap-2 rounded-full px-3 py-1.5 text-left text-xs text-body transition-colors hover:bg-page hover:text-h1"
                  >
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", h.ok ? "bg-green" : "bg-red")} aria-label={h.ok ? "passe" : tr("bloqué")} />
                    <span className="truncate">{h.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Résultat */}
      <div className="grid min-w-0 content-start gap-5">
        {!result ? (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
              <Cloud size={22} />
            </span>
            <p className="mt-4 font-semibold text-h1">{tr("Prêt à simuler")}</p>
            <p className="mt-1 text-sm text-meta">
              {tr("Choisis une source et une destination : le paquet traverse les commutateurs, la passerelle, le pare-feu et les tunnels VPN tels que décrits dans l'IPAM. Idéal pour valider une règle avant la mise en prod.")}</p>
          </div>
        ) : (
          <div key={run} className="grid gap-5">
            <Alert kind={result.ok ? "success" : "error"} title={result.ok ? tr("Le paquet passe") : tr("Le paquet est bloqué")}>
              {tr(result.summary)}
              {result.srcIp && result.dstIp && (
                <span className="mt-1 block font-mono text-xs text-meta">
                  {result.srcIp} → {result.dstIp}
                  {result.rule ? tr(" · règle : {name}", { name: result.rule.name }) : ""}
                </span>
              )}
            </Alert>

            {/* Trajet animé */}
            <div className="overflow-x-auto rounded-2xl border border-line-subtle bg-box p-5 sm:p-6">
              <div className="relative max-sm:hidden" style={{ minWidth: `${result.hops.length * 6.5}rem` }}>
                {/* Ligne du trajet : grise, puis menthe jusqu'au dernier saut atteint */}
                <span
                  aria-hidden
                  className="absolute top-7 h-0.5 rounded-full bg-line"
                  style={{ left: `${50 / result.hops.length}%`, right: `${50 / result.hops.length}%` }}
                />
                <span
                  aria-hidden
                  className="sim-progress absolute top-7 h-0.5 rounded-full bg-accent"
                  style={{
                    left: `${50 / result.hops.length}%`,
                    width: `${(stopIndex / result.hops.length) * 100}%`,
                    ["--hops" as string]: stopIndex,
                  }}
                />
                <span
                  aria-hidden
                  className="sim-packet"
                  style={{
                    ["--from" as string]: `${50 / result.hops.length}%`,
                    ["--to" as string]: `${((stopIndex + 0.5) / result.hops.length) * 100}%`,
                    ["--hops" as string]: stopIndex,
                  }}
                />
                <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${result.hops.length}, minmax(0, 1fr))` }}>
                  {result.hops.map((h, i) => {
                    const Icon = HOP_ICON[h.kind];
                    const tone = h.status === "ok" ? TONE_VAR.green : h.status === "warn" ? TONE_VAR.yellow : TONE_VAR.red;
                    const reached = i <= stopIndex;
                    return (
                      <li key={i} className="sim-hop flex min-w-0 flex-col items-center px-1 text-center" style={{ animationDelay: `${i * 380}ms` }}>
                        <span
                          className={cn("relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 bg-page", !reached && "opacity-40")}
                          style={{ borderColor: reached ? tone : "var(--mm-border)", color: reached ? tone : "var(--mm-muted)" }}
                        >
                          <Icon size={22} aria-hidden />
                          {reached && (
                            <span
                              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[0.65rem] font-bold"
                              style={{ background: tone, color: "var(--mm-surface)" }}
                              aria-hidden
                            >
                              {h.status === "ok" ? "✓" : h.status === "warn" ? "!" : "✕"}
                            </span>
                          )}
                        </span>
                        <span className="mt-2 block w-full truncate text-sm font-medium text-h1">{h.label}</span>
                        {h.sub && <span className="block w-full truncate font-mono text-[0.7rem] text-meta">{tr(h.sub)}</span>}
                      </li>
                    );
                  })}
                </ol>
              </div>
              {/* Mobile : frise verticale */}
              <ol className="grid gap-3 sm:hidden">
                {result.hops.map((h, i) => {
                  const Icon = HOP_ICON[h.kind];
                  const tone = h.status === "ok" ? TONE_VAR.green : h.status === "warn" ? TONE_VAR.yellow : TONE_VAR.red;
                  const reached = i <= stopIndex;
                  return (
                    <li key={i} className="sim-hop flex items-center gap-3" style={{ animationDelay: `${i * 380}ms` }}>
                      <span
                        className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 bg-page", !reached && "opacity-40")}
                        style={{ borderColor: reached ? tone : "var(--mm-border)", color: reached ? tone : "var(--mm-muted)" }}
                      >
                        <Icon size={18} aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-h1">{h.label}</span>
                        {h.sub && <span className="block truncate font-mono text-[0.7rem] text-meta">{tr(h.sub)}</span>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>

            {/* Détail saut par saut */}
            <ol className="grid gap-2">
              {result.hops.map((h, i) => (
                <li key={i} className="sim-hop flex items-start gap-3 rounded-2xl border border-line-subtle bg-box px-4 py-3" style={{ animationDelay: `${i * 380}ms` }}>
                  <span className="mt-0.5 w-5 shrink-0 text-center font-mono text-xs text-meta">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-h1">
                      {h.label}
                      {h.sub && <span className="ml-2 font-mono text-xs text-meta">{tr(h.sub)}</span>}
                    </span>
                    <span className="block text-sm text-body">{tr(h.detail)}</span>
                  </span>
                  <span
                    className="shrink-0 font-mono text-xs font-semibold"
                    style={{ color: h.status === "ok" ? TONE_VAR.green : h.status === "warn" ? TONE_VAR.yellow : TONE_VAR.red }}
                  >
                    {h.status === "ok" ? "OK" : h.status === "warn" ? "ATTENTION" : tr("ÉCHEC")}
                  </span>
                </li>
              ))}
            </ol>

            {result.warnings.length > 0 && (
              <Alert kind="warning" title={tr("À vérifier")}>
                <ul className="list-disc pl-4">
                  {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Alert>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
