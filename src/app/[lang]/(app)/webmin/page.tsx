import type { Metadata } from "next";
import { Suspense } from "react";
import { ExternalLink, KeyRound, Settings } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { fetchWebmin } from "@/lib/integrations";
import { Alert } from "@/components/ui/alert";
import { Badge, Tag } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatBytes, formatUptime, pct } from "@/lib/utils";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Webmin") };
}

export default async function WebminPage() {
  const tr = await getT();
  return (
    <>
      <PageHeader
        title={tr("Instances Webmin")}
        description={tr("Toutes tes instances Webmin au même endroit : interface, système et mises à jour relevés par SSH.")}
        actions={
          <ButtonLink href="/parametres#integrations" variant="secondary" icon={<Settings size={16} />}>
            {tr("Intégrations")}</ButtonLink>
        }
      />
      <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}>
        <Instances />
      </Suspense>
    </>
  );
}

async function Instances() {
  const tr = await getT();
  await requireUser();
  const sources = await fetchWebmin();
  if (!sources.length) {
    return (
      <EmptyState
        title={tr("Aucune instance Webmin")}
        action={
          <ButtonLink href="/parametres#integrations" icon={<Settings size={16} />}>
            {tr("Ajouter une instance")}</ButtonLink>
        }
      >
        {tr("Ajoute tes serveurs Webmin dans les intégrations, puis une clé SSH pour remonter l'état système.")}</EmptyState>
    );
  }
  const online = sources.filter((s) => s.data?.web.up).length;
  const updates = sources.reduce((n, s) => n + (s.data?.system?.updates ?? 0), 0);
  return (
    <section aria-label={tr("Instances Webmin")}>
      <SectionTitle>
        {online}/{sources.length} {tr("joignable(s)")}{updates > 0 && tr(" · {updates} mise(s) à jour en attente", { updates: updates })}
      </SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sources.map((s) => {
          const d = s.data;
          const sys = d?.system;
          const up = !!d?.web.up;
          return (
            <Card key={s.id} className={cn("flex flex-col p-5", !up && "border-[color-mix(in_srgb,var(--mm-red)_40%,transparent)]")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-h1">{s.name}</p>
                  <p className="truncate font-mono text-xs text-meta">{sys?.hostname || new URL(s.url).host}</p>
                </div>
                <Badge tone={up ? "green" : "red"} dot>
                  {up ? tr("En ligne") : tr("Injoignable")}
                </Badge>
              </div>

              {!s.ok && (
                <Alert kind="error" title={tr("Erreur")} className="mt-4">
                  {s.error}
                </Alert>
              )}
              {d?.sshError && (
                <Alert kind="warning" title="SSH" className="mt-4">
                  {d.sshError}
                </Alert>
              )}

              {sys ? (
                <>
                  <p className="mt-4 truncate text-sm text-body" title={`${sys.os} · ${sys.kernel}`}>
                    {sys.os || tr("OS inconnu")}
                  </p>
                  <div className="mt-4 grid gap-3">
                    {sys.load && sys.cpus ? (
                      <Meter label={tr("Charge")} value={(sys.load[0] / sys.cpus) * 100} detail={sys.load.map((l) => l.toFixed(2)).join(" ")} />
                    ) : null}
                    {sys.memTotal ? (
                      <Meter
                        label={tr("Mémoire")}
                        value={pct(sys.memUsed ?? 0, sys.memTotal)}
                        detail={`${formatBytes(sys.memUsed, tr.locale)} / ${formatBytes(sys.memTotal, tr.locale)}`}
                      />
                    ) : null}
                    {sys.diskTotal ? (
                      <Meter
                        label="Disque /"
                        value={pct(sys.diskUsed ?? 0, sys.diskTotal)}
                        detail={`${formatBytes(sys.diskUsed, tr.locale)} / ${formatBytes(sys.diskTotal, tr.locale)}`}
                      />
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {sys.webminVersion && <Tag>{tr("Webmin ")}{sys.webminVersion}</Tag>}
                    {sys.webminService && sys.webminService !== "active" && (
                      <Badge tone="red">{tr("Service ")}{sys.webminService}</Badge>
                    )}
                    {sys.updates !== null && (
                      <Badge tone={sys.updates > 0 ? "yellow" : "green"}>
                        {sys.updates > 0 ? tr("{updates} mise(s) à jour", { updates: sys.updates }) : tr("À jour")}
                      </Badge>
                    )}
                    {sys.rebootRequired && <Badge tone="orange">{tr("Redémarrage requis")}</Badge>}
                  </div>
                </>
              ) : (
                d &&
                !d.ssh && (
                  <p className="mt-4 flex items-center gap-2 text-sm text-meta">
                    <KeyRound size={14} aria-hidden="true" /> {tr("Ajoute une clé SSH pour voir l'état système.")}</p>
                )
              )}

              <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                <span className="font-mono text-xs text-meta">
                  {sys?.uptime ? `⏱ ${formatUptime(sys.uptime, tr.locale)}` : d?.web.up ? `${d.web.ms} ms` : ""}
                </span>
                <ButtonLink href={s.url} target="_blank" rel="noreferrer" variant="secondary" size="sm" icon={<ExternalLink size={14} />}>
                  {tr("Ouvrir")}</ButtonLink>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
