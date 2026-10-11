import type { Metadata } from "next";
import { Suspense } from "react";
import { Boxes, Plus, RefreshCw } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { allTags, assetCounts, listAssets } from "@/lib/data/assets";
import { listVlans } from "@/lib/data/network";
import { listIntegrations } from "@/lib/data/integrations";
import { ASSET_KINDS, ASSET_KIND_META, ASSET_STATUSES, ASSET_STATUS_META } from "@/lib/constants";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Tag } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterBar } from "@/components/filter-bar";
import { AssetTable } from "@/features/inventory/asset-table";
import { SyncProxmoxButton } from "@/features/proxmox/sync-button";
import Link from "next/link";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Inventaire") };
}

export default async function InventoryPage({ searchParams }: PageProps<"/[lang]/inventaire">) {
  const tr = await getT();
  return (
    <>
      <PageHeader
        title={tr("Tout ton matériel, au même endroit")}
        description={tr("Serveurs physiques, machines virtuelles, conteneurs LXC et Docker, équipements réseau — avec leur configuration matérielle et leur adressage.")}
        actions={
          <ButtonLink href="/inventaire/nouveau" icon={<Plus size={16} />}>
            {tr("Ajouter")}</ButtonLink>
        }
      />
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <Inventory searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Inventory({ searchParams }: { searchParams: PageProps<"/[lang]/inventaire">["searchParams"] }) {
  const tr = await getT();
  await requireUser();
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const filters = { kind: pick("kind"), status: pick("status"), q: pick("q"), tag: pick("tag"), vlan: pick("vlan") };
  const assets = listAssets(filters);
  const counts = assetCounts();
  const tags = allTags();
  const vlans = listVlans();
  const hasProxmox = listIntegrations("proxmox", true).length > 0;

  const tabHref = (kind?: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v && k !== "kind") p.set(k, v);
    if (kind) p.set("kind", kind);
    return `/inventaire${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:gap-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <LinkTabs
          label={tr("Filtrer par type")}
          active={filters.kind ?? ""}
          items={[
            { value: "", label: tr("Tout"), href: tabHref(), count: counts.total },
            ...ASSET_KINDS.filter((k) => counts.byKind[k]).map((k) => ({
              value: k,
              label: ASSET_KIND_META[k].plural,
              href: tabHref(k),
              count: counts.byKind[k],
            })),
          ]}
        />
        {hasProxmox && <SyncProxmoxButton icon={<RefreshCw size={15} />} />}
      </div>

      <FilterBar
        placeholder={tr("Nom, hostname, IP, OS, tag…")}
        selects={[
          { name: "status", label: tr("Tous les états"), options: ASSET_STATUSES.map((s) => ({ value: s, label: tr(ASSET_STATUS_META[s].label) })) },
          { name: "vlan", label: tr("Tous les VLAN"), options: vlans.map((v) => ({ value: String(v.vlan_id), label: `VLAN ${v.vlan_id} · ${v.name}` })) },
        ]}
      />

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-xs uppercase tracking-[0.14em] text-meta">{tr("Tags")}</span>
          {tags.slice(0, 24).map(({ tag, count }) => {
            const p = new URLSearchParams();
            for (const [k, v] of Object.entries(filters)) if (v && k !== "tag") p.set(k, v);
            if (filters.tag !== tag) p.set("tag", tag);
            return (
              <Link key={tag} href={`/inventaire${p.size ? `?${p}` : ""}`} scroll={false} aria-pressed={filters.tag === tag}>
                <Tag className={filters.tag === tag ? "border-accent bg-accent-soft text-accent-text" : "hover:border-line-strong"}>
                  {`${tag} ${count}`}
                </Tag>
              </Link>
            );
          })}
        </div>
      )}

      {assets.length === 0 ? (
        <EmptyState
          icon={<Boxes size={22} />}
          title={counts.total === 0 ? tr("L'inventaire est vide") : tr("Aucun résultat")}
          action={
            counts.total === 0 ? (
              <ButtonLink href="/inventaire/nouveau?kind=physical" icon={<Plus size={16} />}>
                {tr("Ajouter un premier serveur")}</ButtonLink>
            ) : (
              <ButtonLink href="/inventaire" variant="secondary">
                {tr("Réinitialiser les filtres")}</ButtonLink>
            )
          }
        >
          {counts.total === 0
            ? tr("Commence par tes serveurs physiques, puis ajoute les VM, CT et conteneurs qu'ils hébergent.")
            : tr("Aucun élément ne correspond à ces filtres.")}
        </EmptyState>
      ) : (
        <>
          <AssetTable assets={assets} />
          <p className="font-mono text-xs text-meta">
            {assets.length} {tr("élément(s) affiché(s) sur ")}{counts.total}
          </p>
        </>
      )}
    </div>
  );
}
