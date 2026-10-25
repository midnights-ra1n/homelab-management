import { use, useTransition } from "react";
import Link from "next/link";
import {
  Box, CircuitBoard, Copy, Cpu, EthernetPort, Fan, Gpu, HardDrive, MemoryStick, Monitor, Network, Package, RadioTower, Router, Server, Undo2, Wifi, Zap, type LucideIcon,
} from "lucide-react";
import { deleteHardwareAction, duplicateHardwareAction, installHardwareAction } from "@/actions/hardware";
import { ActionButton } from "@/components/ui/action-button";
import { Badge, Tag } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { inputClass } from "@/components/ui/form";
import { useToast } from "@/components/ui/toaster";
import { HARDWARE_CATEGORY_META, HARDWARE_MACHINES, HARDWARE_STATUS_META, type HardwareCategory } from "@/lib/constants";
import { listHardware, type HardwareItem } from "@/lib/data/hardware";
import { assetOptions, type Asset } from "@/lib/data/assets";
import { daysUntil, formatDate, formatGb } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { HardwareDialog, type HardwareOptions } from "./hardware-dialog";

export const CATEGORY_ICON: Record<HardwareCategory, LucideIcon> = {
  server: Server, pc: Monitor, router: Router, wifi_router: Wifi, switch: Network, ap: RadioTower, cpu: Cpu, ram: MemoryStick, disk: HardDrive, motherboard: CircuitBoard, gpu: Gpu,
  psu: Zap, nic: EthernetPort, case: Box, cooling: Fan, other: Package,
};

function StatusBadge({ item }: { item: HardwareItem }) {
  const tr = useT();
  const meta = HARDWARE_STATUS_META[item.status];
  return <Badge tone={meta.tone} dot>{tr(meta.label)}</Badge>;
}

/** Capacité totale (Go) des pièces d'une catégorie, lots compris. */
export const totalGb = (items: HardwareItem[], category: HardwareCategory) =>
  items.filter((h) => h.category === category).reduce((n, h) => n + (h.capacity_gb ?? 0) * h.quantity, 0);

const price = (h: HardwareItem, locale: string) =>
  h.purchase_price != null ? `${(h.purchase_price * h.quantity).toLocaleString(locale, { maximumFractionDigits: 2 })} €` : null;

/** « × 4 » à côté du nom d'un lot. */
function Qty({ item }: { item: HardwareItem }) {
  return item.quantity > 1 ? <span className="ml-1.5 font-mono text-sm text-accent-text tabular-nums">× {item.quantity}</span> : null;
}

/** Marque · modèle · caractéristiques · capacité, ce qui est renseigné. */
function details(item: HardwareItem) {
  return [item.brand, item.model, item.specs, item.capacity_gb != null ? formatGb(item.capacity_gb) : ""].filter(Boolean).join(" · ");
}

function Warranty({ date }: { date: string | null }) {
  const tr = useT();
  if (!date) return <span className="text-meta">—</span>;
  const days = daysUntil(date);
  const tone = days < 0 ? "text-red" : days <= 30 ? "text-yellow" : "text-body";
  return <span className={tone} title={days < 0 ? tr("Garantie expirée") : undefined}>{formatDate(date, tr.locale)}</span>;
}

function ItemActions({ item, options }: { item: HardwareItem; options: HardwareOptions }) {
  const tr = useT();
  return (
    <div className="flex items-center justify-end gap-1">
      <HardwareDialog item={item} options={options} />
      <ActionButton action={() => duplicateHardwareAction(item.id)} variant="subtle" size="icon-sm" icon={<Copy size={14} />} title={tr("Dupliquer")} />
      <ConfirmButton
        action={() => deleteHardwareAction(item.id)}
        message={
          item.components > 0
            ? tr("Supprimer « {name} » ? Ses {n} composant(s) seront remis en stock.", { name: item.name, n: item.components })
            : tr("Supprimer « {name} » du stock ?", { name: item.name })
        }
      />
    </div>
  );
}

/** Liste déroulante « Installer un composant » d'un équipement : les composants libres du stock. */
function InstallSelect({ machine, free }: { machine: HardwareItem; free: HardwareItem[] }) {
  const tr = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  if (!free.length) return null;
  return (
    <select
      className={inputClass}
      value=""
      disabled={pending}
      aria-label={tr("Installer un composant dans {name}", { name: machine.name })}
      onChange={(e) => {
        const id = Number(e.target.value);
        start(async () => {
          const r = await installHardwareAction(id, machine.id);
          toast(r.ok ? "success" : "error", tr(r.message));
        });
      }}
    >
      <option value="">{tr("+ Installer un composant du stock…")}</option>
      {free.map((c) => (
        <option key={c.id} value={c.id}>
          {tr(HARDWARE_CATEGORY_META[c.category].label)} · {c.name}
          {c.quantity > 1 ? ` (${tr("{n} en stock", { n: c.quantity })})` : ""}
        </option>
      ))}
    </select>
  );
}

/** Carte d'un équipement : ses composants, leur retrait et l'installation depuis le stock. */
export function MachineCard({ machine, parts, free, options }: { machine: HardwareItem; parts: HardwareItem[]; free: HardwareItem[]; options: HardwareOptions }) {
  const tr = useT();
  const Icon = CATEGORY_ICON[machine.category];
  const [ram, disk] = [totalGb(parts, "ram"), totalGb(parts, "disk")];
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
          <Icon size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-h1">{machine.name}<Qty item={machine} /></p>
          <p className="truncate text-sm text-meta">{details(machine) || tr(HARDWARE_CATEGORY_META[machine.category].label)}</p>
        </div>
        <ItemActions item={machine} options={options} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge item={machine} />
        <span className="font-mono text-xs text-meta">{machine.hl_id}</span>
        {ram > 0 && <Tag>RAM {formatGb(ram)}</Tag>}
        {disk > 0 && <Tag>{tr("Disques")} {formatGb(disk)}</Tag>}
        {machine.asset_id && (
          <Link href={`/inventaire/${machine.asset_id}`} className="text-accent-text hover:underline">
            {tr("Inventaire : {name}", { name: machine.asset_name ?? `#${machine.asset_id}` })}
          </Link>
        )}
      </div>
      {parts.length ? (
        <ul className="grid gap-1 border-t border-line pt-3">
          {parts.map((p) => {
            const PartIcon = CATEGORY_ICON[p.category];
            return (
              <li key={p.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1 text-sm">
                <PartIcon size={15} className="shrink-0 text-meta" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-h1">{p.name}</span>
                  <Qty item={p} />
                  {details(p) && <span className="text-meta"> · {details(p)}</span>}
                </span>
                {p.status !== "in_use" && <StatusBadge item={p} />}
                <ActionButton
                  action={() => installHardwareAction(p.id, null)}
                  variant="subtle"
                  size="icon-sm"
                  icon={<Undo2 size={14} />}
                  title={tr("Retirer et remettre en stock")}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        (machine.category === "server" || machine.category === "pc") && (
          <p className="border-t border-line pt-3 text-sm text-meta">{tr("Aucun composant enregistré.")}</p>
        )
      )}
      <InstallSelect machine={machine} free={free} />
    </Card>
  );
}

/** Composants (tout sauf les machines) : cartes sur mobile, tableau à partir de 640 px. */
export function ComponentTable({ items, options }: { items: HardwareItem[]; options: HardwareOptions }) {
  const tr = useT();
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line sm:hidden">
        {items.map((c) => {
          const Icon = CATEGORY_ICON[c.category];
          const cost = price(c, tr.locale);
          return (
            <li key={c.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-start gap-3">
                <Icon size={16} className="mt-0.5 shrink-0 text-meta" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-h1">{c.name}<Qty item={c} /></p>
                  <p className="text-sm text-meta">
                    {tr(HARDWARE_CATEGORY_META[c.category].label)}
                    {details(c) && ` · ${details(c)}`}
                  </p>
                </div>
                <ItemActions item={c} options={options} />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-7 text-sm">
                <StatusBadge item={c} />
                {c.parent_name && <span className="text-body">{tr("dans {name}", { name: c.parent_name })}</span>}
                {c.location && <span className="text-meta">{c.location}</span>}
                {c.warranty_until && <span className="text-meta">{tr("Garantie")} <Warranty date={c.warranty_until} /></span>}
                {cost && <span className="font-mono text-meta tabular-nums">{cost}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pl-7 text-xs text-meta">
                <span className="font-mono">{c.hl_id}</span>
                {c.serial_number && <span className="font-mono">S/N {c.serial_number}</span>}
                {c.tags.map((t) => <Tag key={t}>{t}</Tag>)}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mm-table-wrap hidden sm:block">
        <table className="mm-table min-w-[56rem]">
          <thead>
            <tr>
              <th>{tr("Composant")}</th>
              <th>{tr("Catégorie")}</th>
              <th>{tr("État")}</th>
              <th>{tr("Installé dans")}</th>
              <th>{tr("Emplacement")}</th>
              <th>{tr("Garantie")}</th>
              <th className="mm-col-num">{tr("Prix")}</th>
              <th><span className="sr-only">{tr("Actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const Icon = CATEGORY_ICON[c.category];
              return (
                <tr key={c.id}>
                  <td className="max-w-[22rem]">
                    <div className="flex items-center gap-2.5">
                      <Icon size={15} className="shrink-0 text-meta" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="truncate text-h1">{c.name}<Qty item={c} /></p>
                        <p className="truncate text-xs text-meta">
                          <span className="font-mono">{c.hl_id}</span>
                          {details(c) && ` · ${details(c)}`}
                          {c.serial_number && <span className="font-mono"> · S/N {c.serial_number}</span>}
                        </p>
                        {c.tags.length > 0 && <p className="mt-0.5 flex gap-1">{c.tags.map((t) => <Tag key={t}>{t}</Tag>)}</p>}
                      </div>
                    </div>
                  </td>
                  <td>{tr(HARDWARE_CATEGORY_META[c.category].label)}</td>
                  <td><StatusBadge item={c} /></td>
                  <td>{c.parent_name ?? <span className="text-meta">—</span>}</td>
                  <td>{c.location || <span className="text-meta">—</span>}</td>
                  <td><Warranty date={c.warranty_until} /></td>
                  <td className="mm-col-num">{price(c, tr.locale) ?? "—"}</td>
                  <td><ItemActions item={c} options={options} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Fiche inventaire : les équipements du stock liés à cet élément, ou de quoi l'y ajouter pré-rempli. */
export function AssetHardware({ asset }: { asset: Asset }) {
  const tr = useT();
  const all = use(listHardware());
  const assets = use(assetOptions(["physical", "network"]));
  const machines = all.filter((h) => h.asset_id === asset.id);
  const options: HardwareOptions = {
    machines: all.filter((h) => HARDWARE_MACHINES.includes(h.category)).map((h) => ({ id: h.id, name: h.name })),
    assets: assets.map((a) => ({ id: a.id, display_name: a.display_name })),
  };
  if (!machines.length) {
    if (asset.kind !== "physical" && asset.kind !== "network") return null;
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
        <span className="text-meta">{tr("Pas encore dans le stock matériel.")}</span>
        <HardwareDialog
          options={options}
          asset={asset}
          defaultCategory={asset.kind === "network" ? "switch" : "server"}
          label="Ajouter au stock"
          variant="ghost"
        />
      </Card>
    );
  }
  const free = all.filter((h) => !HARDWARE_MACHINES.includes(h.category) && h.parent_id == null && h.status !== "retired" && h.status !== "faulty");
  return (
    <>
      {machines.map((m) => (
        <MachineCard key={m.id} machine={m} parts={all.filter((h) => h.parent_id === m.id)} free={free} options={options} />
      ))}
    </>
  );
}
