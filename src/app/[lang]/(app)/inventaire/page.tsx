import type { Metadata } from "next";
import { Suspense } from "react";
import { Boxes, Plus, X } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { allTags, assetCounts, assetOptions, hostOptions, listAssets } from "@/lib/data/assets";
import { listVlans } from "@/lib/data/network";
import { ASSET_KINDS, ASSET_KIND_META, ASSET_STATUSES, ASSET_STATUS_META } from "@/lib/constants";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterBar } from "@/components/filter-bar";
import { AssetTable } from "@/features/inventory/asset-table";
import Link from "next/link";
import { QuickAddAsset } from "@/features/inventory/quick-add";
import { assetFormOptions } from "./form-data";
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
          <>
            <Suspense fallback={null}>
              <QuickAdd />
            </Suspense>
            <ButtonLink href="/inventaire/nouveau" icon={<Plus size={16} />}>
              {tr("Ajouter")}
            </ButtonLink>
          </>
        }
      />
      <Suspense fallback={<Skeleton className="h-96 rounded-[10px]" />}>
        <Inventory searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function QuickAdd() {
  await requireUser();
  const { parents, subnets } = assetFormOptions();
  return <QuickAddAsset parents={parents} subnets={subnets} />;
}

const FILTER_KEYS = ["kind", "status", "q", "tag", "vlan", "host"] as const;

async function Inventory({ searchParams }: { searchParams: PageProps<"/[lang]/inventaire">["searchParams"] }) {
  const tr = await getT();
  await requireUser();
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, pick(k)])) as Record<(typeof FILTER_KEYS)[number], string | undefined>;
  const assets = listAssets(filters);
  const counts = assetCounts();
  const tags = allTags();
  const vlans = listVlans();
  const hosts = hostOptions();

  /** URL de la liste avec un filtre changé ; sort et view sont conservés. */
  const hrefWith = (key: string, value?: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== key) p.set(k, v);
    if (value) p.set(key, value);
    return `/inventaire${p.size ? `?${p}` : ""}`;
  };

  // Puces des filtres actifs (le type a déjà ses onglets).
  const chips = [
    filters.q && { key: "q", label: `« ${filters.q} »` },
    filters.status && { key: "status", label: tr(ASSET_STATUS_META[filters.status as keyof typeof ASSET_STATUS_META]?.label ?? filters.status) },
    filters.vlan && { key: "vlan", label: `VLAN ${filters.vlan}` },
    filters.host && { key: "host", label: tr("sur {name}", { name: hosts.find((h) => String(h.id) === filters.host)?.display_name ?? `#${filters.host}` }) },
    filters.tag && { key: "tag", label: `#${filters.tag}` },
  ].filter(Boolean) as { key: string; label: string }[];
  const clearAll = () => {
    const p = new URLSearchParams();
    for (const k of ["sort", "view"]) if (typeof sp[k] === "string") p.set(k, sp[k] as string);
    return `/inventaire${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <LinkTabs
          label={tr("Filtrer par type")}
          active={filters.kind ?? ""}
          items={[
            { value: "", label: tr("Tout"), href: hrefWith("kind"), count: counts.total },
            ...ASSET_KINDS.filter((k) => counts.byKind[k]).map((k) => ({
              value: k,
              label: tr(ASSET_KIND_META[k].plural),
              href: hrefWith("kind", k),
              count: counts.byKind[k],
            })),
          ]}
        />
      </div>

      <FilterBar
        placeholder={tr("Nom, hostname, IP, MAC, n° de série, tag…")}
        selects={[
          { name: "status", label: tr("Tous les états"), options: ASSET_STATUSES.map((s) => ({ value: s, label: tr(ASSET_STATUS_META[s].label) })) },
          { name: "vlan", label: tr("Tous les VLAN"), options: vlans.map((v) => ({ value: String(v.vlan_id), label: `VLAN ${v.vlan_id} · ${v.name}` })) },
          { name: "host", label: tr("Tous les hôtes"), options: hosts.map((h) => ({ value: String(h.id), label: `${h.display_name} (${h.count})` })) },
          { name: "tag", label: tr("Tous les tags"), options: tags.map(({ tag, count }) => ({ value: tag, label: `${tag} (${count})` })) },
        ]}
      />

      {chips.length > 0 && (
        <div className="-mt-2 flex flex-wrap items-center gap-2" aria-label={tr("Filtres actifs")}>
          {chips.map((c) => (
            <Link
              key={c.key}
              href={hrefWith(c.key)}
              scroll={false}
              aria-label={tr("Retirer le filtre {label}", { label: c.label })}
              className="mm-badge mm-badge--accent h-7 gap-1.5 pl-3 pr-2 text-sm hover:bg-[var(--mm-selection)]"
            >
              {c.label}
              <X size={13} aria-hidden="true" />
            </Link>
          ))}
          {chips.length > 1 && (
            <Link href={clearAll()} scroll={false} className="text-sm text-accent-text hover:underline">
              {tr("Tout effacer")}
            </Link>
          )}
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
              <ButtonLink href={clearAll()} variant="secondary">
                {tr("Réinitialiser les filtres")}</ButtonLink>
            )
          }
        >
          {counts.total === 0
            ? tr("Commence par tes serveurs physiques, puis ajoute les VM, CT et conteneurs qu'ils hébergent.")
            : tr("Aucun élément ne correspond à ces filtres.")}
        </EmptyState>
      ) : (
        <AssetTable assets={assets} hosts={assetOptions(["physical", "vm", "lxc", "network", "other"])} />
      )}
    </div>
  );
}
