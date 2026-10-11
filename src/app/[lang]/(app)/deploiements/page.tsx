import type { Metadata } from "next";
import { Suspense } from "react";
import { LayoutGrid, List, Plus, Rocket } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { deploymentCounts, listDeployments } from "@/lib/data/deployments";
import { DeploymentList } from "@/features/deployments/deployment-list";
import { ViewSwitch } from "@/components/view-switch";
import { resolveView } from "@/lib/view-pref";
import { DEPLOYMENT_KINDS, DEPLOYMENT_KIND_META, DEPLOYMENT_STATUSES, DEPLOYMENT_STATUS_META } from "@/lib/constants";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { SkeletonGrid } from "@/components/ui/skeleton";
import { LinkTabs } from "@/components/ui/tabs";
import { FilterBar } from "@/components/filter-bar";
import { DeploymentCard } from "@/features/deployments/deployment-card";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Déploiements") };
}

export default async function DeploymentsPage({ searchParams }: PageProps<"/[lang]/deploiements">) {
  const tr = await getT();
  return (
    <>
      <PageHeader
        title={tr("Ce qui arrive dans le homelab")}
        description={tr("Planifie les serveurs, VM, conteneurs et applications à déployer, suis leur état et la checklist de ce qu'il reste à faire.")}
        actions={
          <ButtonLink href="/deploiements/nouveau" icon={<Plus size={16} />}>
            {tr("Nouveau déploiement")}</ButtonLink>
        }
      />
      <Suspense fallback={<SkeletonGrid />}>
        <Deployments searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Deployments({ searchParams }: { searchParams: PageProps<"/[lang]/deploiements">["searchParams"] }) {
  const tr = await getT();
  await requireUser();
  const sp = await searchParams;
  const mode = await resolveView("deploiements", ["liste", "cartes"] as const, "liste", sp.mode);
  const modeHref = (m: string) => {
    const p = new URLSearchParams();
    for (const k of ["vue", "kind", "q"]) if (typeof sp[k] === "string") p.set(k, sp[k] as string);
    p.set("mode", m);
    return `/deploiements?${p}`;
  };
  const modeSwitch = (
    <ViewSwitch
      name="deploiements"
      value={mode}
      options={[
        { value: "liste", label: tr("Liste"), icon: <List size={13} aria-hidden />, href: modeHref("liste") },
        { value: "cartes", label: tr("Cartes"), icon: <LayoutGrid size={13} aria-hidden />, href: modeHref("cartes") },
      ]}
    />
  );

  const view = typeof sp.vue === "string" ? sp.vue : "active";
  const kind = typeof sp.kind === "string" ? sp.kind : undefined;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const counts = deploymentCounts();
  const deployments = listDeployments({ status: view === "all" ? undefined : view === "done" ? "done" : "active", kind, q });

  const href = (v: string) => {
    const p = new URLSearchParams();
    if (v !== "active") p.set("vue", v);
    if (kind) p.set("kind", kind);
    if (q) p.set("q", q);
    p.set("mode", mode);
    return `/deploiements${p.size ? `?${p}` : ""}`;
  };

  // Regroupement par état (vue « actifs » et « tous »)
  const groups = DEPLOYMENT_STATUSES.map((s) => ({ status: s, items: deployments.filter((d) => d.status === s) })).filter(
    (g) => g.items.length,
  );

  return (
    <div className="grid grid-cols-1 gap-8 xl:gap-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        {modeSwitch}
        <LinkTabs
          label={tr("Vue")}
          active={view}
          items={[
            { value: "active", label: tr("En cours"), href: href("active"), count: counts.active },
            { value: "done", label: tr("Terminés"), href: href("done"), count: counts.by.done ?? 0 },
            { value: "all", label: tr("Tous"), href: href("all"), count: counts.total },
          ]}
        />
        <FilterBar
          className="flex-1"
          placeholder={tr("Rechercher un déploiement…")}
          selects={[{ name: "kind", label: tr("Tous les types"), options: DEPLOYMENT_KINDS.map((k) => ({ value: k, label: tr(DEPLOYMENT_KIND_META[k].label) })) }]}
        />
      </div>

      {deployments.length === 0 ? (
        <EmptyState
          icon={<Rocket size={22} />}
          title={counts.total === 0 ? tr("Aucun déploiement planifié") : tr("Rien à afficher")}
          action={
            <ButtonLink href="/deploiements/nouveau" icon={<Plus size={16} />}>
              {tr("Planifier un déploiement")}</ButtonLink>
          }
        >
          {tr("Ajoute une VM, un CT, une application ou un serveur à déployer, avec sa checklist d'étapes.")}</EmptyState>
      ) : mode === "liste" ? (
        <DeploymentList deployments={deployments} />
      ) : (
        groups.map((g) => (
          <section key={g.status} aria-label={tr(DEPLOYMENT_STATUS_META[g.status].label)}>
            <SectionTitle>
              {tr(DEPLOYMENT_STATUS_META[g.status].label)} · {g.items.length}
            </SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {g.items.map((d) => (
                <DeploymentCard key={d.id} d={d} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
