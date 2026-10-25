import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { saveHardwareAction } from "@/actions/hardware";
import { FormDialog } from "@/components/ui/form-dialog";
import { Field, inputClass, SelectField, Switch, TextAreaField, TextField } from "@/components/ui/form";
import {
  HARDWARE_CATEGORIES,
  HARDWARE_CATEGORY_META,
  HARDWARE_MACHINES,
  HARDWARE_STATUSES,
  HARDWARE_STATUS_META,
  type HardwareCategory,
} from "@/lib/constants";
import type { HardwareItem } from "@/lib/data/hardware";
import { getAsset, type Asset } from "@/lib/data/assets";
import { formatGb } from "@/lib/utils";
import { useT } from "@/i18n/client";

export type HardwareOptions = {
  machines: { id: number; name: string }[];
  assets: { id: number; display_name: string }[];
};

/** Ce que l'inventaire sait d'un équipement, sous forme de valeurs du formulaire. */
function fromAsset(a: Asset): Record<string, string> {
  const cpu = a.cpu_model && ((a.cpu_sockets ?? 1) > 1 ? `${a.cpu_sockets} × ${a.cpu_model}` : a.cpu_model);
  const ram = a.ram_gb ? `${formatGb(a.ram_gb)} ${a.ram_type}`.trim() : "";
  const disks = a.disks.length ? `${a.disks.length} disque(s)` : "";
  return {
    name: a.display_name,
    brand: a.manufacturer,
    model: a.model,
    serial_number: a.serial_number,
    location: a.location,
    specs: [cpu, ram, disks, a.gpu].filter(Boolean).join(", "),
    ...(a.status === "online" ? { status: "in_use" } : {}),
  };
}

/** Remplit les champs encore vides du formulaire (l'état est toujours repris). */
function fill(form: HTMLFormElement | null, values: Record<string, string>) {
  for (const [name, v] of Object.entries(values)) {
    const el = form?.elements.namedItem(name) as HTMLInputElement | null;
    if (el && v && (name === "status" || !el.value.trim())) el.value = v;
  }
}

const COMPONENTS = HARDWARE_CATEGORIES.filter((c) => !HARDWARE_MACHINES.includes(c));

/**
 * Ajout ou modification d'un matériel. Un équipement (serveur, PC, routeur, switch, borne…) se lie à
 * l'inventaire, qui pré-remplit la fiche ; un composant s'installe dans un équipement.
 */
export function HardwareDialog({
  item,
  options,
  defaultCategory = "disk",
  defaultParent,
  asset,
  label = "Ajouter du matériel",
  variant,
}: {
  item?: HardwareItem;
  options: HardwareOptions;
  defaultCategory?: HardwareCategory;
  defaultParent?: number;
  /** Ouvert depuis une fiche de l'inventaire : l'équipement y est lié et pré-rempli. */
  asset?: Asset;
  label?: string;
  variant?: "primary" | "ghost";
}) {
  const tr = useT();
  const [category, setCategory] = useState<HardwareCategory>(item?.category ?? defaultCategory);
  const [assetId, setAssetId] = useState(String(item?.asset_id ?? asset?.id ?? ""));
  const machine = HARDWARE_MACHINES.includes(category);
  const seed = !item && asset ? fromAsset(asset) : {};
  const v = (k: keyof HardwareItem) => (item ? (item[k] as string | number | null) ?? "" : (seed[k] ?? ""));
  const sized = category === "ram" || category === "disk";
  const icon = !item && !variant;
  return (
    <FormDialog
      title={item ? tr("Modifier « {name} »", { name: item.name }) : tr(label)}
      action={saveHardwareAction.bind(null, item?.id ?? null)}
      trigger={item ? undefined : tr(label)}
      triggerVariant={item ? "subtle" : (variant ?? "primary")}
      triggerSize={item ? "icon-sm" : variant === "ghost" ? "sm" : "md"}
      triggerIcon={item ? <Pencil size={14} /> : <Plus size={icon ? 16 : 14} />}
      triggerLabel={item ? tr("Modifier") : tr(label)}
      size="lg"
    >
      {/* 1. Quoi, et où il se trouve */}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={tr("Type")} name="category">
          {(p) => (
            <select {...p} className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as HardwareCategory)}>
              <optgroup label={tr("Équipements")}>
                {HARDWARE_MACHINES.map((c) => <option key={c} value={c}>{tr(HARDWARE_CATEGORY_META[c].label)}</option>)}
              </optgroup>
              <optgroup label={tr("Composants")}>
                {COMPONENTS.map((c) => <option key={c} value={c}>{tr(HARDWARE_CATEGORY_META[c].label)}</option>)}
              </optgroup>
            </select>
          )}
        </Field>
        {machine ? (
          <SelectField
            label={tr("Élément de l'inventaire")}
            name="asset_id"
            value={assetId}
            onChange={(e) => {
              setAssetId(e.target.value);
              if (!item && e.target.value) {
                const form = e.currentTarget.form;
                getAsset(Number(e.target.value)).then((a) => a && fill(form, fromAsset(a)));
              }
            }}
            placeholder={tr("— Aucun —")}
            options={options.assets.map((a) => ({ value: a.id, label: a.display_name }))}
            hint={item ? undefined : tr("Déjà dans l'inventaire ? Choisis-le : la fiche se remplit toute seule.")}
          />
        ) : (
          <SelectField
            label={tr("Installé dans")}
            name="parent_id"
            defaultValue={item?.parent_id ?? defaultParent ?? ""}
            placeholder={tr("— En stock —")}
            options={options.machines.map((m) => ({ value: m.id, label: m.name }))}
          />
        )}
      </div>
      {machine && !item && assetId && (
        <Switch
          name="import_components"
          label={tr("Ajouter aussi ses composants")}
          hint={tr("Processeur, RAM, disques, GPU et cartes réseau connus de l'inventaire, installés dans cet équipement")}
          defaultChecked
        />
      )}

      {/* 2. Identité */}
      <div className="grid gap-5 sm:grid-cols-3">
        <TextField label={tr("Nom")} name="name" defaultValue={v("name")} placeholder={machine ? "pve-01" : tr("Samsung 990 Pro 2 To")} required autoFocus className="sm:col-span-2" />
        <TextField
          label={tr("ID homelab")}
          name="hl_id"
          defaultValue={item?.hl_id}
          placeholder={tr("Automatique")}
          className="font-mono"
          autoComplete="off"
        />
        <TextField label={tr("Marque")} name="brand" defaultValue={v("brand")} placeholder={machine ? "Dell" : "Samsung"} />
        <TextField label={tr("Modèle")} name="model" defaultValue={v("model")} placeholder={machine ? "PowerEdge R730" : "MZ-V9P2T0BW"} />
        <TextField label={tr("N° de série")} name="serial_number" defaultValue={v("serial_number")} className="font-mono" />
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <SelectField
          label={tr("État")}
          name="status"
          defaultValue={v("status") || (defaultParent ? "in_use" : "stock")}
          options={HARDWARE_STATUSES.map((s) => ({ value: s, label: tr(HARDWARE_STATUS_META[s].label) }))}
        />
        <TextField
          label={tr("Caractéristiques")}
          name="specs"
          defaultValue={v("specs")}
          placeholder={machine ? tr("2U, 2 × Xeon, 8 baies") : tr("NVMe PCIe 4.0")}
          className="sm:col-span-2"
        />
      </div>
      {!machine && (
        <div className="grid gap-5 sm:grid-cols-2">
          {sized && (
            <TextField
              label={tr("Capacité (Go)")}
              name="capacity_gb"
              inputMode="decimal"
              defaultValue={item?.capacity_gb ?? ""}
              placeholder={category === "ram" ? "16" : "2000"}
            />
          )}
          <TextField
            label={tr("Quantité")}
            name="quantity"
            type="number"
            min={1}
            step={1}
            defaultValue={item?.quantity ?? 1}
            hint={tr(sized ? "Pièces identiques, de la même capacité. Capacités différentes : une ligne chacune (Dupliquer)." : "Pièces identiques")}
          />
        </div>
      )}

      {/* 3. Le reste, replié */}
      <details className="grid gap-5" open={!!(item && (item.vendor || item.purchase_date || item.purchase_price || item.warranty_until || item.notes || item.location))}>
        <summary className="cursor-pointer text-sm font-medium text-h2">{tr("Emplacement, achat, garantie et notes")}</summary>
        <div className="mt-5 grid gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField label={tr("Emplacement")} name="location" defaultValue={v("location")} placeholder={tr("Baie, tiroir, carton…")} />
            <TextField label={tr("Fournisseur")} name="vendor" defaultValue={item?.vendor} placeholder="LDLC" />
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <TextField label={tr("Date d'achat")} name="purchase_date" type="date" defaultValue={item?.purchase_date ?? ""} />
            <TextField label={tr("Prix unitaire (€)")} name="purchase_price" inputMode="decimal" defaultValue={item?.purchase_price ?? ""} />
            <TextField label={tr("Fin de garantie")} name="warranty_until" type="date" defaultValue={item?.warranty_until ?? ""} />
          </div>
          <TextField label={tr("Tags")} name="tags" defaultValue={item?.tags.join(", ")} placeholder={tr("nas, occasion")} hint={tr("Séparés par des virgules")} />
          <TextAreaField label={tr("Notes")} name="notes" defaultValue={item?.notes} rows={3} />
        </div>
      </details>
    </FormDialog>
  );
}
