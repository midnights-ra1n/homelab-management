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

export const metadata: Metadata = { title: "Webmin" };

export default function WebminPage() {
  return (
    <>
      <PageHeader
        title="Instances Webmin"
        description="Toutes tes instances Webmin au même endroit : interface, système et mises à jour relevés par SSH."
        actions={
          <ButtonLink href="/parametres#integrations" variant="secondary" icon={<Settings size={16} />}>
            Intégrations
          </ButtonLink>
        }
      />
      <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}>
        <Instances />
      </Suspense>
    </>
  );
}

async function Instances() {
  await requireUser();
  const sources = await fetchWebmin();
  if (!sources.length) {
    return (
      <EmptyState
        title="Aucune instance Webmin"
        action={
          <ButtonLink href="/parametres#integrations" icon={<Settings size={16} />}>
            Ajouter une instance
          </ButtonLink>
        }
      >
        Ajoute tes serveurs Webmin dans les intégrations, puis une clé SSH pour remonter l&apos;état système.
      </EmptyState>
    );
  }
  const online = sources.filter((s) => s.data?.web.up).length;
  const updates = sources.reduce((n, s) => n + (s.data?.system?.updates ?? 0), 0);
  return (
    <section aria-label="Instances Webmin">
      <SectionTitle>
        {online}/{sources.length} joignable(s){updates > 0 && ` · ${updates} mise(s) à jour en attente`}
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
                  {up ? "En ligne" : "Injoignable"}
                </Badge>
              </div>

              {!s.ok && (
                <Alert kind="error" title="Erreur" className="mt-4">
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
                    {sys.os || "OS inconnu"}
                  </p>
                  <div className="mt-4 grid gap-3">
                    {sys.load && sys.cpus ? (
                      <Meter label="Charge" value={(sys.load[0] / sys.cpus) * 100} detail={sys.load.map((l) => l.toFixed(2)).join(" ")} />
                    ) : null}
                    {sys.memTotal ? (
                      <Meter
                        label="Mémoire"
                        value={pct(sys.memUsed ?? 0, sys.memTotal)}
                        detail={`${formatBytes(sys.memUsed)} / ${formatBytes(sys.memTotal)}`}
                      />
                    ) : null}
                    {sys.diskTotal ? (
                      <Meter
                        label="Disque /"
                        value={pct(sys.diskUsed ?? 0, sys.diskTotal)}
                        detail={`${formatBytes(sys.diskUsed)} / ${formatBytes(sys.diskTotal)}`}
                      />
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {sys.webminVersion && <Tag>Webmin {sys.webminVersion}</Tag>}
                    {sys.webminService && sys.webminService !== "active" && (
                      <Badge tone="red">Service {sys.webminService}</Badge>
                    )}
                    {sys.updates !== null && (
                      <Badge tone={sys.updates > 0 ? "yellow" : "green"}>
                        {sys.updates > 0 ? `${sys.updates} mise(s) à jour` : "À jour"}
                      </Badge>
                    )}
                    {sys.rebootRequired && <Badge tone="orange">Redémarrage requis</Badge>}
                  </div>
                </>
              ) : (
                d &&
                !d.ssh && (
                  <p className="mt-4 flex items-center gap-2 text-sm text-meta">
                    <KeyRound size={14} aria-hidden="true" /> Ajoute une clé SSH pour voir l&apos;état système.
                  </p>
                )
              )}

              <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                <span className="font-mono text-xs text-meta">
                  {sys?.uptime ? `⏱ ${formatUptime(sys.uptime)}` : d?.web.up ? `${d.web.ms} ms` : ""}
                </span>
                <ButtonLink href={s.url} target="_blank" rel="noreferrer" variant="secondary" size="sm" icon={<ExternalLink size={14} />}>
                  Ouvrir
                </ButtonLink>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
