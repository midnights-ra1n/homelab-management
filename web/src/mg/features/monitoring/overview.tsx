import { use } from "react";
import Link from "next/link";
import { ExternalLink, Globe, PackageCheck, Radar, RotateCcw, Server, ShieldAlert } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { SectionTitle } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { hlmKind, StatusIcon, statusTone, type StatusKind } from "@/components/status-icon";
import { fetchHlm, fetchProxmox, machineKeys, summarize } from "@/lib/integrations";
import { pctOf, probeKind, type HlmMonitor } from "@/lib/integrations/hlm";
import { collectAlerts } from "@/lib/monitor/alerts";
import { formatPct } from "@/lib/monitor/format";
import { cn, daysUntil } from "@/lib/utils";
import { UptimeBars } from "./charts";
import { BandwidthChart, BandwidthFigures } from "../../../shared/bandwidth";
import { getT } from "@/i18n/server";

const SOON_DAYS = 21;
const MAX_PROBES = 12;
const MAX_HOSTS = 9;
const MAX_UPDATES = 5;
const RANK: Record<StatusKind, number> = { down: 0, warn: 1, pending: 2, maintenance: 3, paused: 4, ok: 5 };

/* Bandeau d'état global ------------------------------------------------------ */

/** État de toute l'infrastructure suivie par Midnights Monitoring + lien vers sa page de statut. */
export function StatusHero() {
  const tr = use(getT());
  const [{ m, alerts }, hlm] = [use(collectAlerts(tr)), use(fetchHlm())];
  const red = alerts.filter((a) => a.tone === "red");
  // Nothing followed (no integration, or no probe nor host yet): neutral, never "all is well".
  const empty = !alerts.length && m.monitored === 0;
  const kind: StatusKind = red.length ? "down" : alerts.length ? "warn" : empty ? "pending" : "ok";
  const tone = statusTone(kind);
  const title =
    kind === "down"
      ? tr("{n} problème(s) en cours", { n: red.length })
      : kind === "warn"
        ? tr("Opérationnel, {n} point(s) à surveiller", { n: alerts.length })
        : !empty
          ? tr("Tous les services sont opérationnels")
          : m.configured
            ? tr("Rien n'est encore surveillé")
            : tr("Supervision non configurée");
  const quiet = !empty
    ? tr("Aucune alerte sur les sondes, les hôtes, les conteneurs et les mises à jour.")
    : m.configured
      ? tr("Ajoute des sondes ou installe l'agent sur tes hôtes dans Midnights Monitoring : leur état apparaîtra ici.")
      : tr("Aucune sonde ni aucun hôte n'est suivi : connecte Midnights Monitoring pour voir l'état de l'infrastructure.");
  return (
    <div
      className="flex flex-col gap-5 rounded-xl border px-5 py-5 sm:px-6 md:flex-row md:items-center md:justify-between"
      style={{
        background: `color-mix(in srgb, ${tone} 8%, var(--mm-surface))`,
        borderColor: `color-mix(in srgb, ${tone} 35%, var(--mm-border))`,
      }}
    >
      <div className="flex min-w-0 items-start gap-4">
        <StatusIcon kind={kind} size={30} className="mt-0.5" />
        <div className="min-w-0">
          <p className="text-lg font-semibold text-h1 sm:text-xl">{title}</p>
          {alerts.length > 0 ? (
            <ul className="mt-2 grid gap-1 text-sm text-body">
              {alerts.slice(0, 4).map((a, i) => (
                <li key={i} className="flex min-w-0 items-center gap-2">
                  <StatusIcon kind={a.tone === "red" ? "down" : "warn"} size={14} />
                  <span className="truncate">{a.text}</span>
                </li>
              ))}
              {alerts.length > 4 && <li className="text-xs text-meta">{tr("+ {n} autre(s)", { n: alerts.length - 4 })}</li>}
            </ul>
          ) : (
            <p className="text-sm text-body">{quiet}</p>
          )}
        </div>
      </div>
      {hlm.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-2">
          {hlm.map((s) => (
            <ButtonLink key={s.id} href={`${s.url}/status`} target="_blank" rel="noreferrer" icon={<Globe size={15} />}>
              {hlm.length > 1 ? tr("Statut · {name}", { name: s.name }) : tr("Page de statut")}
            </ButtonLink>
          ))}
        </div>
      )}
    </div>
  );
}

/* Midnights Monitoring : résumé ---------------------------------------------- */

function uptime90(m: HlmMonitor) {
  const known = (m.days ?? []).filter((d) => d.uptime !== null);
  return known.length ? (known.reduce((a, d) => a + d.uptime!, 0) / known.length) * 100 : null;
}

const certDaysLeft = (m: HlmMonitor) => (m.cert_expires_at ? daysUntil(new Date(m.cert_expires_at * 1000).toISOString()) : null);

/** Résumé du hub : chiffres clés, tuiles compactes des sondes et des hôtes ; le détail reste dans le hub. */
export function HlmOverview() {
  const tr = use(getT());
  const [sources, pve] = [use(fetchHlm()), use(fetchProxmox())];
  const hub = sources[0];
  // Un hôte Proxmox remonte par l'agent et par l'API Proxmox : on le relie au nœud au lieu de le doubler.
  const nodes = new Map<string, string>();
  for (const p of pve) for (const n of p.data?.nodes ?? []) if (n.node) nodes.set(n.node.toLowerCase(), `/proxmox/${p.id}/${encodeURIComponent(n.node)}`);

  const probes = sources
    .flatMap((s) => (s.data?.monitors ?? []).map((m) => ({ ...m, key: `${s.id}:${m.id}`, kind: hlmKind(m.status, m) })))
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.name.localeCompare(b.name));
  const hosts = sources
    .flatMap((s) => (s.data?.hosts ?? []).map((h) => ({ ...h, key: `${s.id}:${h.id}`, kind: hlmKind(h.status, h) })))
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.name.localeCompare(b.name));
  const activeProbes = probes.filter((m) => m.enabled);
  const uptimes = activeProbes.map(uptime90).filter((u): u is number => u !== null);
  const certs = probes.filter((m) => m.cert_expires_at);
  const expiring = certs.filter((m) => certDaysLeft(m)! < SOON_DAYS);
  const bandwidth = summarize(sources).bandwidth;

  return (
    <section aria-labelledby="hlm-title" className="grid gap-5">
      <SectionTitle
        id="hlm-title"
        actions={
          hub && (
            <div className="flex flex-wrap justify-end gap-1">
              <ButtonLink href={`${hub.url}/monitors`} target="_blank" rel="noreferrer" variant="ghost" size="sm" icon={<Radar size={13} />}>
                {tr("Sondes")}
              </ButtonLink>
              <ButtonLink href={`${hub.url}/hosts`} target="_blank" rel="noreferrer" variant="ghost" size="sm" icon={<Server size={13} />}>
                {tr("Hôtes")}
              </ButtonLink>
              <ButtonLink href={hub.url} target="_blank" rel="noreferrer" variant="ghost" size="sm" icon={<ExternalLink size={13} />}>
                {tr("Ouvrir le hub")}
              </ButtonLink>
            </div>
          )
        }
      >
        Midnights Monitoring
      </SectionTitle>
      {sources
        .filter((s) => !s.ok)
        .map((s) => (
          <Alert key={s.id} kind="error" title={tr("{name} : erreur", { name: s.name })}>
            {s.error}
          </Alert>
        ))}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:gap-6">
        <Stat
          label={tr("Hôtes")}
          value={`${hosts.filter((h) => h.kind === "ok").length}/${hosts.length}`}
          detail={tr("opérationnel(s)")}
          icon={<Server size={16} />}
          tone={hosts.some((h) => h.kind === "down") ? "red" : undefined}
        />
        <Stat
          label={tr("Sondes")}
          value={`${activeProbes.filter((m) => m.kind === "ok").length}/${activeProbes.length}`}
          detail={tr("HTTP(S), TCP, DNS, SSL")}
          icon={<Radar size={16} />}
          tone={activeProbes.some((m) => m.kind === "down") ? "red" : undefined}
        />
        <Stat
          label={tr("Disponibilité 90 j")}
          value={formatPct(uptimes.length ? uptimes.reduce((a, u) => a + u, 0) / uptimes.length : null, 2, tr.locale)}
          detail={tr("moyenne des sondes")}
        />
        <Stat
          label={tr("Certificats")}
          value={certs.length ? `${certs.length - expiring.length}/${certs.length}` : "—"}
          detail={expiring.length ? tr("{n} expire(nt) sous {d} j", { n: expiring.length, d: SOON_DAYS }) : tr("valides")}
          icon={<ShieldAlert size={16} />}
          tone={expiring.length ? "yellow" : undefined}
        />
      </div>

      {probes.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {probes.slice(0, MAX_PROBES).map((m) => {
            const days = (m.days ?? []).slice(-30).map((d) => ({
              day: new Date(d.day * 1000).toISOString().slice(0, 10),
              checks: 0,
              uptime: d.uptime === null ? null : d.uptime * 100,
              avg: null,
            }));
            const certDays = certDaysLeft(m);
            const note =
              m.kind === "down" || m.kind === "warn"
                ? m.message
                : certDays !== null && certDays < SOON_DAYS
                  ? tr("Certificat : {n} j restants", { n: certDays })
                  : m.latency_ms != null
                    ? `${Math.round(m.latency_ms)} ms`
                    : m.message;
            return (
              <li
                key={m.key}
                className={cn("grid gap-3 rounded-xl border border-line-subtle bg-box p-4", !m.enabled && "opacity-60")}
                style={m.kind === "down" ? { borderColor: `color-mix(in srgb, ${statusTone("down")} 40%, var(--mm-border))` } : undefined}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <StatusIcon kind={m.kind} size={18} />
                  <p className="min-w-0 flex-1 truncate font-medium text-h1" title={m.target}>
                    {m.name}
                  </p>
                  <span className="shrink-0 rounded-full border border-line-subtle px-1.5 font-mono text-[0.65rem] text-meta">{probeKind(m)}</span>
                  <span className="shrink-0 font-mono text-sm font-semibold text-h1">{formatPct(uptime90(m), 1, tr.locale)}</span>
                </div>
                <UptimeBars days={days} height={16} />
                <p className={cn("truncate font-mono text-xs", m.kind === "down" ? "text-red" : "text-meta")} title={note}>
                  {note || "—"}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {probes.length > MAX_PROBES && hub && (
        <Link href={`${hub.url}/monitors`} target="_blank" rel="noreferrer" className="-mt-2 text-sm text-meta hover:text-accent-text">
          {tr("+ {n} autre(s) sonde(s) dans le hub →", { n: probes.length - MAX_PROBES })}
        </Link>
      )}

      {bandwidth.length > 0 && (
        <div className="grid gap-3">
          <p className="mm-label-caps">{tr("Bande passante (24 h)")}</p>
          <ul className="grid gap-3 lg:grid-cols-2">
            {bandwidth.map((l) => (
              <li key={`${l.url}|${l.target}|${l.interface}`} className="grid gap-3 rounded-xl border border-line-subtle bg-box p-4">
                <div className="flex min-w-0 items-center gap-2.5">
                  <StatusIcon kind={hlmKind(l.status)} size={18} />
                  <a href={`${l.url}/bandwidth`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono font-medium text-h1 no-underline hover:text-accent-text">
                    {l.interface}
                  </a>
                  <span className="shrink-0 truncate font-mono text-xs text-meta">{sources.length > 1 ? `${l.source} · ${l.target}` : l.target}</span>
                </div>
                <BandwidthFigures l={l} compact />
                {(l.in || l.out) && <BandwidthChart t={l.t} l={l} height={120} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hosts.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {hosts.slice(0, MAX_HOSTS).map((h) => {
            const node = machineKeys(h.name, h.info?.hostname).map((k) => nodes.get(k)).find(Boolean);
            const live = h.kind !== "down" && !h.agent_down && h.last_seen > 0 && h.latest;
            return (
              <li key={h.key} className="grid gap-3 rounded-xl border border-line-subtle bg-box p-4">
                <div className="flex min-w-0 items-center gap-2.5">
                  <StatusIcon kind={h.kind} size={18} />
                  <p className="min-w-0 flex-1 truncate font-medium text-h1" title={h.info?.os}>
                    {h.name}
                  </p>
                  {node && (
                    <Link href={node} title={tr("Même machine que le nœud Proxmox")}>
                      <Badge tone="orange">Proxmox</Badge>
                    </Link>
                  )}
                  {h.latest?.temp != null && <span className={cn("shrink-0 font-mono text-xs", h.latest.temp > 80 ? "text-red" : "text-meta")}>{Math.round(h.latest.temp)} °C</span>}
                </div>
                {live ? (
                  <div className="grid grid-cols-3 gap-3">
                    <Meter size="sm" label="CPU" value={h.latest!.cpu} />
                    <Meter size="sm" label="RAM" value={pctOf(h.latest!.mem_used, h.latest!.mem_total)} />
                    <Meter size="sm" label={tr("Disque")} value={pctOf(h.latest!.disk_used, h.latest!.disk_total)} />
                  </div>
                ) : (
                  <p className="text-xs text-meta">
                    {h.agent_down && h.reachable ? tr("Agent hors ligne · hôte en ligne.") : h.agent_down && h.reachable === false ? tr("Hors ligne · injoignable.") : tr("Aucune donnée récente de l'agent.")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {hosts.length > MAX_HOSTS && hub && (
        <Link href={`${hub.url}/hosts`} target="_blank" rel="noreferrer" className="-mt-2 text-sm text-meta hover:text-accent-text">
          {tr("+ {n} autre(s) hôte(s) dans le hub →", { n: hosts.length - MAX_HOSTS })}
        </Link>
      )}
      {hosts.length === 0 && probes.length === 0 && sources.every((s) => s.ok) && (
        <p className="text-sm text-meta">{tr("Aucun hôte équipé de l'agent.")}</p>
      )}
    </section>
  );
}

/* Mises à jour : résumé ----------------------------------------------------- */

/** Mises à jour relevées par les agents de Midnights Monitoring. */
export function UpdatesSummary() {
  const tr = use(getT());
  const hlm = use(fetchHlm());
  const items = hlm.flatMap((s) =>
    (s.data?.hosts ?? [])
      .filter((h) => h.updates)
      .map((h) => ({
        key: `h${s.id}:${h.id}`,
        name: h.name,
        source: hlm.length > 1 ? s.name : "Midnights Monitoring",
        pending: h.updates!.pending,
        security: h.updates!.security,
        reboot: h.updates!.reboot_required,
      })),
  );
  if (items.length === 0 && hlm.every((s) => s.ok)) return null;
  const todo = items.filter((h) => h.pending > 0 || h.reboot).sort((a, b) => b.security - a.security || b.pending - a.pending);
  const pending = items.reduce((n, h) => n + h.pending, 0);
  const security = items.reduce((n, h) => n + h.security, 0);
  const reboot = items.filter((h) => h.reboot).length;

  return (
    <section aria-labelledby="updates-title" className="grid gap-5">
      <SectionTitle
        id="updates-title"
        actions={
          <div className="flex flex-wrap justify-end gap-1">
            {hlm.map((s) => (
              <ButtonLink key={s.id} href={`${s.url}/updates`} target="_blank" rel="noreferrer" variant="ghost" size="sm" icon={<ExternalLink size={13} />}>
                {hlm.length > 1 ? s.name : "Midnights Monitoring"}
              </ButtonLink>
            ))}
          </div>
        }
      >
        {tr("Mises à jour")}
      </SectionTitle>
      {hlm
        .filter((s) => !s.ok)
        .map((s) => (
          <Alert key={`${s.id}`} kind="error" title={tr("{name} : erreur", { name: s.name })}>
            {s.error}
          </Alert>
        ))}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:gap-6">
        <Stat label={tr("Hôtes à jour")} value={`${items.length - todo.length}/${items.length}`} icon={<PackageCheck size={16} />} tone={todo.length ? undefined : "green"} />
        <Stat label={tr("Paquets en attente")} value={pending} detail={tr("tous hôtes confondus")} />
        <Stat label={tr("Sécurité")} value={security} detail={tr("correctifs de sécurité")} icon={<ShieldAlert size={16} />} tone={security ? "red" : undefined} />
        <Stat label={tr("Redémarrages")} value={reboot} detail={tr("hôte(s) à redémarrer")} icon={<RotateCcw size={16} />} tone={reboot ? "yellow" : undefined} />
      </div>
      {todo.length > 0 ? (
        <ul className="divide-y divide-line-subtle overflow-hidden rounded-xl border border-line-subtle bg-box">
          {todo.slice(0, MAX_UPDATES).map((h) => (
            <li key={h.key} className="flex min-w-0 items-center gap-3 px-4 py-3">
              <StatusIcon kind={h.security ? "down" : "warn"} size={18} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-h1">{h.name}</span>
                <span className="block font-mono text-xs text-meta">{h.source}</span>
              </span>
              {h.reboot && <Badge tone="yellow">{tr("Redémarrage")}</Badge>}
              {h.security > 0 && <Badge tone="red">{tr("{n} sécu.", { n: h.security })}</Badge>}
              <span className="w-16 shrink-0 text-right font-mono text-sm text-h2">{h.pending}</span>
            </li>
          ))}
          {todo.length > MAX_UPDATES && (
            <li className="px-4 py-2.5 text-xs text-meta">{tr("+ {n} autre(s) hôte(s) avec des mises à jour", { n: todo.length - MAX_UPDATES })}</li>
          )}
        </ul>
      ) : (
        items.length > 0 && (
          <p className="flex items-center gap-2 text-sm text-body">
            <StatusIcon kind="ok" /> {tr("Tous les hôtes sont à jour.")}
          </p>
        )
      )}
    </section>
  );
}
