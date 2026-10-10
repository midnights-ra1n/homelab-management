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

export const metadata: Metadata = { title: "Déploiements" };

export default function DeploymentsPage({ searchParams }: PageProps<"/deploiements">) {
  return (
    <>
      <PageHeader
        title="Ce qui arrive dans le homelab"
        description="Planifie les serveurs, VM, conteneurs et applications à déployer, suis leur état et la checklist de ce qu'il reste à faire."
        actions={
          <ButtonLink href="/deploiements/nouveau" icon={<Plus size={16} />}>
            Nouveau déploiement
          </ButtonLink>
        }
      />
      <Suspense fallback={<SkeletonGrid />}>
        <Deployments searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Deployments({ searchParams }: { searchParams: PageProps<"/deploiements">["searchParams"] }) {
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
        { value: "liste", label: "Liste", icon: <List size={13} aria-hidden />, href: modeHref("liste") },
        { value: "cartes", label: "Cartes", icon: <LayoutGrid size={13} aria-hidden />, href: modeHref("cartes") },
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
          label="Vue"
          active={view}
          items={[
            { value: "active", label: "En cours", href: href("active"), count: counts.active },
            { value: "done", label: "Terminés", href: href("done"), count: counts.by.done ?? 0 },
            { value: "all", label: "Tous", href: href("all"), count: counts.total },
          ]}
        />
        <FilterBar
          className="flex-1"
          placeholder="Rechercher un déploiement…"
          selects={[{ name: "kind", label: "Tous les types", options: DEPLOYMENT_KINDS.map((k) => ({ value: k, label: DEPLOYMENT_KIND_META[k].label })) }]}
        />
      </div>

      {deployments.length === 0 ? (
        <EmptyState
          icon={<Rocket size={22} />}
          title={counts.total === 0 ? "Aucun déploiement planifié" : "Rien à afficher"}
          action={
            <ButtonLink href="/deploiements/nouveau" icon={<Plus size={16} />}>
              Planifier un déploiement
            </ButtonLink>
          }
        >
          Ajoute une VM, un CT, une application ou un serveur à déployer, avec sa checklist d&apos;étapes.
        </EmptyState>
      ) : mode === "liste" ? (
        <DeploymentList deployments={deployments} />
      ) : (
        groups.map((g) => (
          <section key={g.status} aria-label={DEPLOYMENT_STATUS_META[g.status].label}>
            <SectionTitle>
              {DEPLOYMENT_STATUS_META[g.status].label} · {g.items.length}
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
