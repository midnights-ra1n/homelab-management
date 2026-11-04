import Link from "next/link";
import { Suspense, use, useState } from "react";
import { ExternalLink, Package, Search } from "../../../shared/icons";
import { fmtAgo, fmtBytes, type Host, type NodeApp } from "../../../api";
import { Card, Segmented, STAT_GRID, Stat, inputClass } from "../../../ui";
import { AppState, LastOp, appProblem, appSource, nodeUiUrl } from "../../../pages/NodeApps";
import { fetchHlm } from "@/lib/integrations";
import { agentsState } from "@/lib/data/assets";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getT } from "@/i18n/server";

/** Node.js apps (base-node playbook) of every monitored host, managed from their inventory item. */
export default function NodeJsPage() {
  const tr = use(getT());
  return (
    <>
      <PageHeader title={tr("Applications Node.js")} description={tr("Les applications des machines suivies par le monitoring.")} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Apps />
      </Suspense>
    </>
  );
}

const ROWS = 8;
type Filter = "all" | "problem" | "stopped";
const rank = (a: NodeApp) => (appProblem(a) ? 0 : a.status === "online" ? 2 : 1);

function Apps() {
  const tr = use(getT());
  const sources = use(fetchHlm());
  const { agents } = use(agentsState());
  const [view, setView] = useState<"apps" | "hosts">("apps");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [everything, setEverything] = useState(false);

  // Each host links to its inventory item, or to the monitoring when it has none yet.
  const hosts = sources.flatMap((s) => ((s.data?.hosts ?? []) as unknown as Host[]).filter((h) => h.node_apps).map((h) => {
    const asset = agents.find((a) => a.integration_id === s.id && a.host_id === h.id)?.asset_id;
    return { h, snap: h.node_apps!, ui: nodeUiUrl(h), asset, href: asset ? `/inventaire/${asset}#node` : `${s.url}/hosts/${h.id}#node-title` };
  }));
  if (!hosts.length) {
    return (
      <EmptyState icon={<Package size={18} />} title={tr("Aucune application Node.js")}>
        {tr("Les machines déployées avec le playbook base-node apparaissent ici dès que leur agent est relié au monitoring.")}
      </EmptyState>
    );
  }

  const apps = hosts.flatMap((x) => x.snap.apps.map((app) => ({ ...x, app }))).sort((a, b) => rank(a.app) - rank(b.app));
  const online = apps.filter(({ app }) => app.status === "online");
  const problems = apps.filter(({ app }) => appProblem(app)).length;
  const needle = q.trim().toLowerCase();
  const found = apps.filter(({ app, h }) =>
    (filter === "all" || (filter === "problem" ? appProblem(app) : app.status !== "online" && !appProblem(app))) &&
    (!needle || `${app.name} ${h.name} ${app.repo}`.toLowerCase().includes(needle)));
  const rows = everything ? found : found.slice(0, ROWS);
  const away = (x: (typeof hosts)[number]) => (x.asset ? {} : { target: "_blank", rel: "noreferrer" }); // no inventory item: the monitoring opens apart
  const manage = (x: (typeof hosts)[number]) => (
    <ButtonLink href={x.href} variant="secondary" size="sm" icon={x.asset ? undefined : <ExternalLink size={14} />} {...away(x)}>{tr("Gérer")}</ButtonLink>
  );

  return (
    <div className="grid gap-8">
      <div className={STAT_GRID}>
        <Stat label={tr("Applications")} value={apps.length} detail={tr("Sur {n} hôte(s)", { n: hosts.length })} />
        <Stat label={tr("En ligne")} value={`${online.length}/${apps.length}`} />
        <Stat label={tr("À surveiller")} value={problems} tone={problems ? "red" : undefined} detail={problems ? tr("En erreur ou commit en échec") : tr("Aucun problème")} />
        <Stat label={tr("Mémoire")} value={fmtBytes(online.reduce((n, { app }) => n + app.memory_mb, 0) * 1048576)} detail={tr("Applications en ligne")} />
      </div>
      <Segmented label={tr("Vue")} value={view} onChange={setView} options={[["apps", tr("Applications")], ["hosts", tr("Hôtes")]]} />

      {view === "apps" ? (
        <Card flush title={tr("{n} application(s)", { n: found.length })}>
          <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
            <span className="relative w-full sm:w-64">
              <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-meta" aria-hidden />
              <input type="search" className={`${inputClass} pl-9`} placeholder={tr("Rechercher…")} aria-label={tr("Rechercher une application")} value={q} onChange={(e) => setQ(e.target.value)} />
            </span>
            <Segmented size="sm" label={tr("État")} value={filter} onChange={setFilter} options={[["all", tr("Toutes")], ["problem", tr("À surveiller")], ["stopped", tr("Arrêtées")]]} />
          </div>
          {found.length === 0 ? <p className="px-6 py-8 text-center text-sm text-meta">{tr("Aucune application ne correspond.")}</p> : (<>
            <ul className="mm-list sm:hidden">
              {rows.map((x) => (
                <li key={`${x.href}:${x.app.name}`}>
                  <Link href={x.href} className="mm-list__item items-center no-underline" {...away(x)}>
                    <span className="min-w-0">
                      <span className="mm-list__title block truncate">{x.app.name}</span>
                      <span className="mm-list__meta block truncate">{x.h.name}</span>
                    </span>
                    <AppState a={x.app} />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mm-table-wrap hidden sm:block">
              <table className="mm-table min-w-[48rem]">
                <thead><tr><th scope="col">{tr("Application")}</th><th scope="col">{tr("Hôte")}</th><th scope="col">{tr("État")}</th><th scope="col" className="mm-col-num">{tr("Mémoire")}</th><th scope="col">{tr("Dernière opération")}</th><th scope="col"><span className="sr-only">{tr("Actions")}</span></th></tr></thead>
                <tbody>
                  {rows.map((x) => (
                    <tr key={`${x.href}:${x.app.name}`}>
                      <td className="mm-col-strong max-w-[20rem]">
                        <span className="block truncate">{x.app.name}</span>
                        <span className="block truncate font-mono text-xs font-normal text-meta" title={x.app.repo}>{x.app.port > 0 ? `:${x.app.port} · ` : ""}{appSource(x.app)}</span>
                      </td>
                      <td>{x.h.name}</td>
                      <td><AppState a={x.app} /></td>
                      <td className="mm-col-num">{x.app.status === "online" ? `${x.app.memory_mb} Mo` : "—"}</td>
                      <td><LastOp a={x.app} /></td>
                      <td className="w-px text-right">{manage(x)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>)}
          {found.length > rows.length && <div className="p-4 text-center"><Button variant="ghost" size="sm" onClick={() => setEverything(true)}>{tr("Voir toutes les applications")} ({found.length})</Button></div>}
        </Card>
      ) : (
        <Card flush title={tr("{n} hôte(s)", { n: hosts.length })}>
          <ul className="mm-list sm:hidden">
            {hosts.map((x) => (
              <li key={x.href} className="flex items-center">
                <Link href={x.href} className="mm-list__item min-w-0 flex-1 items-center no-underline" {...away(x)}>
                  <span className="min-w-0">
                    <span className="mm-list__title block truncate">{x.h.name}</span>
                    <span className="mm-list__meta block truncate">{x.h.connected ? tr("Connecté") : tr("Hors ligne")} · {fmtAgo(x.snap.collected_at)}</span>
                  </span>
                  <Badge tone={x.snap.failing ? "red" : "muted"}>{x.snap.online}/{x.snap.apps.length}</Badge>
                </Link>
                {x.ui && <ButtonLink href={x.ui} target="_blank" rel="noreferrer" variant="ghost" size="sm" className="mr-2 shrink-0" title="Node.js UI" icon={<ExternalLink size={14} />}>UI</ButtonLink>}
              </li>
            ))}
          </ul>
          <div className="mm-table-wrap hidden sm:block">
            <table className="mm-table min-w-[40rem]">
              <thead><tr><th scope="col">{tr("Hôte")}</th><th scope="col">{tr("Agent")}</th><th scope="col">{tr("En ligne")}</th><th scope="col">{tr("Relevé")}</th><th scope="col"><span className="sr-only">{tr("Actions")}</span></th></tr></thead>
              <tbody>
                {hosts.map((x) => (
                  <tr key={x.href}>
                    <td className="mm-col-strong">{x.h.name}</td>
                    <td><Badge tone={x.h.connected ? "green" : "red"} dot>{x.h.connected ? tr("Connecté") : tr("Hors ligne")}</Badge></td>
                    <td><Badge tone={x.snap.failing ? "red" : "muted"}>{x.snap.online}/{x.snap.apps.length}</Badge></td>
                    <td className="mm-col-muted">{fmtAgo(x.snap.collected_at)}</td>
                    <td className="w-px text-right">
                      <span className="inline-flex gap-2">
                        {x.ui && <ButtonLink href={x.ui} target="_blank" rel="noreferrer" variant="ghost" size="sm" icon={<ExternalLink size={14} />}>Node.js UI</ButtonLink>}
                        {manage(x)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
