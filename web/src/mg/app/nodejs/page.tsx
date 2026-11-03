import Link from "next/link";
import { Suspense, use } from "react";
import { ExternalLink, Package } from "../../../shared/icons";
import type { Host } from "../../../api";
import { STATUS, nodeUiUrl } from "../../../pages/NodeApps";
import { fetchHlm } from "@/lib/integrations";
import { agentsState } from "@/lib/data/assets";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getT } from "@/i18n/server";

/** Node.js apps (base-node playbook) of every monitored host, managed from their inventory item. */
export default function NodeJsPage() {
  const tr = use(getT());
  return (
    <>
      <PageHeader title={tr("Applications Node.js")}
        description={tr("Les applications node-app des machines suivies par le monitoring. Gérer ouvre la fiche de la machine : déploiement, mise à jour, logs, variables, deploy keys et création d'applications.")} />
      <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}>
        <Hosts />
      </Suspense>
    </>
  );
}

function Hosts() {
  const tr = use(getT());
  const sources = use(fetchHlm());
  const { agents } = use(agentsState());
  const hosts = sources.flatMap((s) => ((s.data?.hosts ?? []) as unknown as Host[]).filter((h) => h.node_apps).map((h) => ({ h, src: s })));
  if (!hosts.length) {
    return (
      <EmptyState icon={<Package size={18} />} title={tr("Aucune application Node.js")}>
        {tr("Les machines déployées avec le playbook base-node apparaissent ici dès que leur agent est relié au monitoring.")}
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {hosts.map(({ h, src }) => {
        const asset = agents.find((a) => a.integration_id === src.id && a.host_id === h.id)?.asset_id;
        const ui = nodeUiUrl(h);
        const snap = h.node_apps!;
        return (
          <Card key={`${src.id}:${h.id}`}>
            <CardHeader overline={src.name} title={h.name}
              actions={<span className="flex flex-wrap gap-2">
                {ui && <ButtonLink href={ui} target="_blank" rel="noreferrer" variant="ghost" size="sm" icon={<ExternalLink size={13} />}>Node.js UI</ButtonLink>}
                {asset
                  ? <ButtonLink href={`/inventaire/${asset}#node`} size="sm">{tr("Gérer")}</ButtonLink>
                  : <ButtonLink href={`${src.url}/hosts/${h.id}`} target="_blank" rel="noreferrer" variant="secondary" size="sm" icon={<ExternalLink size={13} />}>{tr("Monitoring")}</ButtonLink>}
              </span>} />
            <CardBody>
              <ul className="grid gap-2">
                {snap.apps.map((a) => (
                  <li key={a.name} className="flex items-center justify-between gap-3 rounded-xl border border-line-subtle bg-page px-3 py-2">
                    <span className="min-w-0">
                      {asset ? <Link href={`/inventaire/${asset}#node`} className="block truncate text-sm text-h1">{a.name}</Link> : <span className="block truncate text-sm text-h1">{a.name}</span>}
                      <span className="block truncate font-mono text-xs text-meta">{[a.branch, a.port && `:${a.port}`].filter(Boolean).join(" · ")}</span>
                    </span>
                    <Badge tone={(STATUS[a.status]?.[1] ?? "yellow") as "yellow"} dot>{STATUS[a.status]?.[0] ?? a.status}</Badge>
                  </li>
                ))}
                {snap.apps.length === 0 && <li className="text-sm text-meta">{tr("Aucune application pour l'instant.")}</li>}
              </ul>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
