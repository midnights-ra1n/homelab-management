import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { ExternalLink, Settings } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listIntegrations } from "@/lib/data/integrations";
import { fetchBeszel, fetchMaintenant, fetchPatchmon, type Source } from "@/lib/integrations";
import { INTEGRATION_META, type IntegrationType } from "@/lib/constants";
import { Alert } from "@/components/ui/alert";
import { Badge, Tag } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, daysUntil, formatDateTime, formatUptime } from "@/lib/utils";
import { UptimeSection } from "@/features/monitoring/uptime-section";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Monitoring") };
}

export default async function MonitoringPage() {
  const tr = await getT();
  return (
    <>
      <PageHeader
        title={tr("Supervision centralisée")}
        description={tr("Disponibilité et temps de réponse de tes services, puis Beszel, Maintenant et PatchMon réunis sur une seule page.")}
        actions={
          <ButtonLink href="/parametres#integrations" variant="secondary" icon={<Settings size={16} />}>
            {tr("Intégrations")}</ButtonLink>
        }
      />
      <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}>
        <Sections />
      </Suspense>
    </>
  );
}

async function Sections() {
  const tr = await getT();
  await requireUser();
  const configured = (t: IntegrationType) => listIntegrations(t, true).length > 0;
  const any = configured("beszel") || configured("maintenant") || configured("patchmon");
  return (
    <div className="grid grid-cols-1 gap-12 xl:gap-16">
      <UptimeSection />
      {!any && (
        <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-dashed border-line px-5 py-5 sm:flex-row sm:items-center sm:px-6">
          <p className="text-sm text-body">
            {tr("Connecte ")}<span className="text-h1">{tr("Beszel")}</span>, <span className="text-h1">{tr("Maintenant")}</span> {tr("ou")}{" "}
            <span className="text-h1">{tr("PatchMon")}</span> {tr("pour ajouter ressources système, conteneurs, certificats et mises à jour.")}</p>
          <ButtonLink href="/parametres#integrations" variant="secondary" size="sm" icon={<Settings size={14} />}>
            {tr("Intégrations")}</ButtonLink>
        </div>
      )}
      {configured("beszel") && (
        <Suspense fallback={<SectionSkeleton title={tr("Beszel")} />}>
          <BeszelSection />
        </Suspense>
      )}
      {configured("maintenant") && (
        <Suspense fallback={<SectionSkeleton title={tr("Maintenant")} />}>
          <MaintenantSection />
        </Suspense>
      )}
      {configured("patchmon") && (
        <Suspense fallback={<SectionSkeleton title="PatchMon" />}>
          <PatchmonSection />
        </Suspense>
      )}
    </div>
  );
}

function SectionSkeleton({ title }: { title: string }) {
  return (
    <section aria-busy="true">
      <SectionTitle>{title}</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-44 rounded-2xl" />
        ))}
      </div>
    </section>
  );
}

async function SourceHeader<T>({ type, sources, children }: { type: IntegrationType; sources: Source<T>[]; children?: ReactNode }) {
  const tr = await getT();
  return (
    <>
      <SectionTitle
        actions={
          <div className="flex flex-wrap justify-end gap-1">
            {sources.map((s) => (
              <ButtonLink key={s.id} href={s.url} target="_blank" rel="noreferrer" variant="ghost" size="sm" icon={<ExternalLink size={13} />}>
                {s.name}
              </ButtonLink>
            ))}
          </div>
        }
      >
        {tr(INTEGRATION_META[type].label)} {children}
      </SectionTitle>
      {sources
        .filter((s) => !s.ok)
        .map((s) => (
          <Alert key={s.id} kind="error" title={tr("{name} : erreur", { name: s.name })} className="mb-4">
            {s.error}
          </Alert>
        ))}
    </>
  );
}

/* Beszel ------------------------------------------------------------------ */

async function BeszelSection() {
  const tr = await getT();
  const sources = await fetchBeszel();
  const systems = sources
    .flatMap((s) => s.data ?? [])
    .sort((a, b) => Number(a.status === "up") - Number(b.status === "up") || a.name.localeCompare(b.name));
  const up = systems.filter((s) => s.status === "up").length;
  return (
    <section aria-label={tr("Beszel")}>
      <SourceHeader type="beszel" sources={sources}>
        · {up}/{systems.length} {tr("en ligne")}</SourceHeader>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {systems.map((s) => {
          const isUp = s.status === "up";
          return (
            <Card key={s.id} className={cn("p-5", !isUp && "border-[color-mix(in_srgb,var(--mm-red)_40%,transparent)]")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-h1">{s.name}</p>
                  <p className="truncate font-mono text-xs text-meta">{s.host}</p>
                </div>
                <Badge tone={isUp ? "green" : s.status === "paused" ? "muted" : s.status === "pending" ? "yellow" : "red"} dot>
                  {isUp ? tr("En ligne") : s.status === "paused" ? tr("En pause") : s.status === "pending" ? tr("En attente") : tr("Hors ligne")}
                </Badge>
              </div>
              {isUp ? (
                <div className="mt-5 grid gap-3">
                  <Meter label="CPU" value={s.cpu} />
                  <Meter label={tr("Mémoire")} value={s.mem} />
                  <Meter label={tr("Disque")} value={s.disk} />
                  {s.gpu !== null && <Meter label="GPU" value={s.gpu} />}
                </div>
              ) : (
                <p className="mt-5 text-sm text-meta">{tr("Aucune donnée récente de l'agent.")}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-meta">
                {s.uptime !== null && <span>⏱ {formatUptime(s.uptime, tr.locale)}</span>}
                {s.temperature !== null && <span className={cn(s.temperature > 80 && "text-red")}>{Math.round(s.temperature)} °C</span>}
                {s.loadAvg && <span>{tr("load ")}{s.loadAvg.map((l) => l.toFixed(2)).join(" ")}</span>}
                {s.cores && <span>{s.cores}c/{s.threads}t</span>}
                {s.agentVersion && <span>v{s.agentVersion}</span>}
              </div>
            </Card>
          );
        })}
        {systems.length === 0 && sources.every((s) => s.ok) && <p className="text-sm text-meta">{tr("Aucun système déclaré dans Beszel.")}</p>}
      </div>
    </section>
  );
}

/* Maintenant -------------------------------------------------------------- */

function containerTone(state: string, health: string | null) {
  if (health === "unhealthy") return "red" as const;
  if (state === "running") return health === "starting" ? ("yellow" as const) : ("green" as const);
  if (state === "exited" || state === "stopped") return "muted" as const;
  if (state === "restarting" || state === "paused") return "yellow" as const;
  return "red" as const;
}

async function MaintenantSection() {
  const tr = await getT();
  const sources = await fetchMaintenant();
  const data = sources.filter((s) => s.data).map((s) => s.data!);
  const containers = data.flatMap((d) => d.containers).sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  const endpoints = data.flatMap((d) => d.endpoints);
  const certificates = data
    .flatMap((d) => d.certificates)
    .sort((a, b) => (a.expiresAt ?? "9").localeCompare(b.expiresAt ?? "9"));
  const heartbeats = data.flatMap((d) => d.heartbeats);
  const updates = data.reduce((n, d) => n + (d.updates ?? 0), 0);
  const running = containers.filter((c) => c.state === "running").length;

  return (
    <section aria-label={tr("Maintenant")} className="grid grid-cols-1 gap-6">
      <div>
        <SourceHeader type="maintenant" sources={sources}>
          · {running}/{containers.length} {tr("conteneurs actifs")}{updates > 0 && tr(" · {updates} mise(s) à jour d'image", { updates: updates })}
        </SourceHeader>
      </div>

      <div className="grid gap-8 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-2">
          <p className="border-b border-line-subtle px-5 py-3 font-mono text-xs uppercase tracking-[0.14em] text-meta">{tr("Conteneurs")}</p>
          <ul className="max-h-[28rem] divide-y divide-line-subtle overflow-y-auto">
            {containers.map((c) => {
              const tone = containerTone(c.state, c.health);
              return (
                <li key={`${c.id}-${c.name}`} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-h1">{c.name}</span>
                    <span className="block truncate font-mono text-xs text-meta">{c.image}</span>
                  </span>
                  {c.host && <Tag className="hidden sm:inline-flex">{c.host}</Tag>}
                  {c.group && <span className="hidden truncate text-xs text-meta md:block">{c.group}</span>}
                  <Badge tone={tone} dot>
                    {c.health ? `${c.state} · ${c.health}` : c.state}
                  </Badge>
                </li>
              );
            })}
            {containers.length === 0 && <li className="px-5 py-8 text-center text-sm text-meta">{tr("Aucun conteneur.")}</li>}
          </ul>
        </Card>

        <div className="grid min-w-0 content-start gap-6">
          <Card className="overflow-hidden">
            <p className="border-b border-line-subtle px-5 py-3 font-mono text-xs uppercase tracking-[0.14em] text-meta">
              {tr("Endpoints · ")}{endpoints.filter((e) => e.status === "up").length}/{endpoints.length}
            </p>
            <ul className="max-h-64 divide-y divide-line-subtle overflow-y-auto">
              {endpoints.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-h2">{e.name}</span>
                    <span className="block truncate font-mono text-xs text-meta">
                      {e.type.toUpperCase()} · {e.target}
                    </span>
                  </span>
                  <Badge tone={e.status === "up" ? "green" : e.status === "degraded" ? "yellow" : e.status === "down" ? "red" : "muted"} dot>
                    {e.status}
                  </Badge>
                </li>
              ))}
              {endpoints.length === 0 && <li className="px-5 py-6 text-center text-sm text-meta">{tr("Aucun endpoint.")}</li>}
            </ul>
          </Card>

          <Card className="overflow-hidden">
            <p className="border-b border-line-subtle px-5 py-3 font-mono text-xs uppercase tracking-[0.14em] text-meta">{tr("Certificats TLS")}</p>
            <ul className="max-h-64 divide-y divide-line-subtle overflow-y-auto">
              {certificates.map((c) => {
                const days = c.expiresAt ? daysUntil(c.expiresAt) : null;
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="truncate font-mono text-sm text-h2">{c.name}</span>
                    <Badge tone={days === null ? "muted" : days < 7 ? "red" : days < 21 ? "yellow" : "green"}>
                      {days === null ? c.status || "—" : days < 0 ? tr("Expiré") : `${days} j`}
                    </Badge>
                  </li>
                );
              })}
              {certificates.length === 0 && <li className="px-5 py-6 text-center text-sm text-meta">{tr("Aucun certificat suivi.")}</li>}
            </ul>
          </Card>

          {heartbeats.length > 0 && (
            <Card className="overflow-hidden">
              <p className="border-b border-line-subtle px-5 py-3 font-mono text-xs uppercase tracking-[0.14em] text-meta">{tr("Heartbeats")}</p>
              <ul className="divide-y divide-line-subtle">
                {heartbeats.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-h2">{h.name}</span>
                      {h.lastPing && <span className="font-mono text-xs text-meta">{formatDateTime(h.lastPing, tr.locale)}</span>}
                    </span>
                    <Badge tone={h.status === "up" ? "green" : h.status === "paused" ? "muted" : h.status === "down" ? "red" : "yellow"} dot>
                      {h.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}

/* PatchMon ---------------------------------------------------------------- */

async function PatchmonSection() {
  const tr = await getT();
  const sources = await fetchPatchmon();
  const hosts = sources
    .flatMap((s) => s.data ?? [])
    .sort((a, b) => b.securityUpdates - a.securityUpdates || b.updates - a.updates);
  const total = hosts.reduce((n, h) => n + h.updates, 0);
  const security = hosts.reduce((n, h) => n + h.securityUpdates, 0);
  return (
    <section aria-label="PatchMon">
      <SourceHeader type="patchmon" sources={sources}>
        · {total} {tr("mise(s) à jour · ")}{security} {tr("sécurité")}</SourceHeader>
      <div className="overflow-hidden rounded-2xl border border-line-subtle bg-box">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead>
              <tr className="border-b border-line-subtle font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">
                <th className="px-5 py-3 font-medium">{tr("Hôte")}</th>
                <th className="px-3 py-3 font-medium">{tr("Système")}</th>
                <th className="px-3 py-3 text-right font-medium">{tr("Mises à jour")}</th>
                <th className="px-3 py-3 text-right font-medium">{tr("Sécurité")}</th>
                <th className="px-3 py-3 font-medium">{tr("État")}</th>
                <th className="px-5 py-3 font-medium">{tr("Dernier rapport")}</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((h) => (
                <tr key={h.id} className="border-b border-line-subtle last:border-0">
                  <td className="px-5 py-3">
                    <p className="font-medium text-h1">{h.friendlyName}</p>
                    <p className="font-mono text-xs text-meta">
                      {h.hostname} · {h.ip}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-body">
                    {h.osType} {h.osVersion}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-h2">{h.updates}</td>
                  <td className={cn("px-3 py-3 text-right font-mono", h.securityUpdates ? "font-semibold text-red" : "text-h2")}>
                    {h.securityUpdates}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone={h.status === "active" || h.status === "up" ? "green" : h.status === "pending" ? "yellow" : "muted"}>
                        {h.status}
                      </Badge>
                      {h.needsReboot && <Badge tone="yellow">{tr("Redémarrage")}</Badge>}
                    </div>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-meta">{formatDateTime(h.lastUpdate, tr.locale)}</td>
                </tr>
              ))}
              {hosts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-meta">
                    {tr("Aucun hôte.")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
