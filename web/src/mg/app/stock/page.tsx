import { Suspense, use } from "react";
import { AlertTriangle, CheckCircle2, Package, Warehouse } from "lucide-react";
import { listHardware } from "@/lib/data/hardware";
import { assetOptions } from "@/lib/data/assets";
import {
  HARDWARE_CATEGORIES,
  HARDWARE_CATEGORY_META,
  HARDWARE_MACHINES,
  HARDWARE_STATUSES,
  HARDWARE_STATUS_META,
} from "@/lib/constants";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { FilterBar } from "@/components/filter-bar";
import { HardwareDialog } from "@/features/hardware/hardware-dialog";
import { ComponentTable, MachineCard, totalGb } from "@/features/hardware/hardware-views";
import { daysUntil, formatGb } from "@/lib/utils";
import { getT } from "@/i18n/server";

export default function StockPage({ searchParams }: PageProps<"/[lang]/stock">) {
  const tr = use(getT());
  return (
    <>
      <PageHeader
        title={tr("Stock matériel")}
        description={tr("Serveurs, PC et composants : ce qui est installé où, ce qui attend en stock et ce qui est en panne.")}
      />
      <Suspense fallback={<Skeleton className="h-[28rem] rounded-3xl" />}>
        <Stock searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function Stock({ searchParams }: { searchParams: PageProps<"/[lang]/stock">["searchParams"] }) {
  const tr = use(getT());
  const sp = use(searchParams);
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const [q, category, status] = [pick("q").toLowerCase(), pick("category"), pick("status")];
  const all = use(listHardware());
  const options = {
    machines: all.filter((h) => HARDWARE_MACHINES.includes(h.category)).map((h) => ({ id: h.id, name: h.name })),
    assets: use(assetOptions(["physical"])).map((a) => ({ id: a.id, display_name: a.display_name })),
  };

  const matches = (h: (typeof all)[number]) =>
    (!category || h.category === category) &&
    (!status || h.status === status) &&
    (!q ||
      [h.hl_id, h.name, h.brand, h.model, h.serial_number, h.specs, h.location, h.parent_name ?? "", ...h.tags].some((v) => v.toLowerCase().includes(q)));
  const isMachine = (h: (typeof all)[number]) => HARDWARE_MACHINES.includes(h.category);
  const machines = all.filter((h) => isMachine(h) && matches(h));
  const components = all.filter((h) => !isMachine(h) && matches(h));
  const free = all.filter((h) => !isMachine(h) && h.parent_id == null && h.status !== "retired" && h.status !== "faulty");

  // Pieces, not rows: a lot of 4 RAM sticks counts 4.
  const pieces = (list: typeof all) => list.reduce((n, h) => n + h.quantity, 0);
  const count = (s: string) => pieces(all.filter((h) => h.status === s));
  const inStock = free.filter((h) => h.status === "stock");
  const stockGb = (c: "ram" | "disk") => totalGb(inStock, c);
  const value = all.reduce((n, h) => n + (h.purchase_price ?? 0) * h.quantity, 0);
  const warrantySoon = all.filter((h) => h.status !== "retired" && h.warranty_until && daysUntil(h.warranty_until) >= 0 && daysUntil(h.warranty_until) <= 30).length;
  const broken = count("faulty") + count("repair");

  if (!all.length) {
    return (
      <EmptyState
        icon={<Warehouse size={18} />}
        title={tr("Le stock est vide")}
        action={<HardwareDialog options={options} defaultCategory="server" label="Ajouter une machine" />}
      >
        {tr("Commence par un serveur ou un PC, puis ajoute ses composants : processeur, RAM, disques…")}
      </EmptyState>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-8">
      <div className="grid grid-cols-2 gap-[var(--mm-grid-gap)] lg:grid-cols-4">
        <Stat
          label={tr("Matériel")}
          value={pieces(all)}
          icon={<Package size={16} />}
          detail={value > 0 ? tr("{v} € d'achats", { v: value.toLocaleString(tr.locale, { maximumFractionDigits: 0 }) }) : tr("{n} machine(s)", { n: options.machines.length })}
        />
        <Stat label={tr("En service")} value={count("in_use")} icon={<CheckCircle2 size={16} />} tone="green" detail={tr("{n} machine(s)", { n: options.machines.length })} />
        <Stat
          label={tr("En stock")}
          value={count("stock")}
          icon={<Warehouse size={16} />}
          detail={[stockGb("ram") && `RAM ${formatGb(stockGb("ram"))}`, stockGb("disk") && `${tr("disques")} ${formatGb(stockGb("disk"))}`].filter(Boolean).join(" · ") || tr("{n} commandé(s)", { n: count("ordered") })}
        />
        <Stat
          label={tr("À surveiller")}
          value={broken + warrantySoon}
          icon={<AlertTriangle size={16} />}
          tone={broken ? "red" : warrantySoon ? "yellow" : undefined}
          detail={tr("{b} en panne ou en réparation · {w} garantie(s) sous 30 j", { b: broken, w: warrantySoon })}
        />
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <FilterBar
          className="flex-1"
          placeholder={tr("ID homelab, nom, marque, modèle, n° de série…")}
          selects={[
            { name: "category", label: tr("Toutes les catégories"), options: HARDWARE_CATEGORIES.map((c) => ({ value: c, label: tr(HARDWARE_CATEGORY_META[c].label) })) },
            { name: "status", label: tr("Tous les états"), options: HARDWARE_STATUSES.map((s) => ({ value: s, label: tr(HARDWARE_STATUS_META[s].label) })) },
          ]}
        />
        <HardwareDialog options={options} />
      </div>

      {machines.length > 0 && (
        <section>
          <SectionTitle actions={<HardwareDialog options={options} defaultCategory="server" label="Ajouter une machine" variant="ghost" />}>
            {tr("Machines")}
          </SectionTitle>
          <div className="grid gap-[var(--mm-grid-gap)] md:grid-cols-2 xl:grid-cols-3">
            {machines.map((m) => (
              <MachineCard key={m.id} machine={m} parts={all.filter((h) => h.parent_id === m.id)} free={free} options={options} />
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle>{tr("Composants")}</SectionTitle>
        {components.length ? (
          <ComponentTable items={components} options={options} />
        ) : (
          <EmptyState icon={<Package size={18} />} title={tr("Aucun composant")}>
            {q || category || status ? tr("Rien ne correspond aux filtres.") : tr("Ajoute des processeurs, barrettes de RAM, disques… puis installe-les dans une machine.")}
          </EmptyState>
        )}
      </section>
    </div>
  );
}
