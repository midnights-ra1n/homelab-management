import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { saveHardwareAction } from "@/actions/hardware";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/form";
import {
  HARDWARE_CATEGORIES,
  HARDWARE_CATEGORY_META,
  HARDWARE_MACHINES,
  HARDWARE_STATUSES,
  HARDWARE_STATUS_META,
  type HardwareCategory,
} from "@/lib/constants";
import type { HardwareItem } from "@/lib/data/hardware";
import { useT } from "@/i18n/client";

export type HardwareOptions = {
  machines: { id: number; name: string }[];
  assets: { id: number; display_name: string }[];
};

/** Ajout ou modification d'un matériel ; une machine se lie à l'inventaire, un composant à une machine. */
export function HardwareDialog({
  item,
  options,
  defaultCategory = "disk",
  defaultParent,
  label = "Ajouter du matériel",
  variant,
}: {
  item?: HardwareItem;
  options: HardwareOptions;
  defaultCategory?: HardwareCategory;
  defaultParent?: number;
  label?: string;
  variant?: "primary" | "ghost";
}) {
  const tr = useT();
  const [category, setCategory] = useState<HardwareCategory>(item?.category ?? defaultCategory);
  const machine = HARDWARE_MACHINES.includes(category);
  const icon = !item && !variant;
  return (
    <FormDialog
      title={item ? tr("Modifier « {name} »", { name: item.name }) : tr("Ajouter du matériel")}
      action={saveHardwareAction.bind(null, item?.id ?? null)}
      trigger={item ? undefined : tr(label)}
      triggerVariant={item ? "subtle" : (variant ?? "primary")}
      triggerSize={item ? "icon-sm" : variant === "ghost" ? "sm" : "md"}
      triggerIcon={item ? <Pencil size={14} /> : <Plus size={icon ? 16 : 14} />}
      triggerLabel={item ? tr("Modifier") : tr(label)}
      size="lg"
    >
      <div className="grid gap-5 sm:grid-cols-3">
        <TextField label={tr("Nom")} name="name" defaultValue={item?.name} placeholder={tr("Samsung 990 Pro 2 To")} required autoFocus className="sm:col-span-3" />
        <SelectField
          label={tr("Catégorie")}
          name="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as HardwareCategory)}
          options={HARDWARE_CATEGORIES.map((c) => ({ value: c, label: tr(HARDWARE_CATEGORY_META[c].label) }))}
        />
        <SelectField
          label={tr("État")}
          name="status"
          defaultValue={item?.status ?? (defaultParent ? "in_use" : "stock")}
          options={HARDWARE_STATUSES.map((s) => ({ value: s, label: tr(HARDWARE_STATUS_META[s].label) }))}
        />
        {machine ? (
          <SelectField
            label={tr("Élément de l'inventaire")}
            name="asset_id"
            defaultValue={item?.asset_id ?? ""}
            placeholder={tr("— Aucun —")}
            options={options.assets.map((a) => ({ value: a.id, label: a.display_name }))}
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
      <div className="grid gap-5 sm:grid-cols-3">
        <TextField label={tr("Marque")} name="brand" defaultValue={item?.brand} placeholder="Samsung" />
        <TextField label={tr("Modèle")} name="model" defaultValue={item?.model} placeholder="MZ-V9P2T0BW" />
        <TextField label={tr("N° de série")} name="serial_number" defaultValue={item?.serial_number} className="font-mono" />
      </div>
      <TextField
        label={tr("Caractéristiques")}
        name="specs"
        defaultValue={item?.specs}
        placeholder={machine ? tr("2U, 2 × Xeon, 8 baies") : tr("NVMe PCIe 4.0, 7450 Mo/s")}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label={tr("Capacité par pièce (Go)")}
          name="capacity_gb"
          inputMode="decimal"
          defaultValue={item?.capacity_gb ?? ""}
          hint={tr("RAM, disques : sert aux totaux")}
        />
        <TextField
          label={tr("Quantité")}
          name="quantity"
          type="number"
          min={1}
          step={1}
          defaultValue={item?.quantity ?? 1}
          hint={tr("Pièces identiques ; installer en sort une à la fois")}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label={tr("Emplacement")} name="location" defaultValue={item?.location} placeholder={tr("Baie, tiroir, carton…")} />
        <TextField label={tr("Fournisseur")} name="vendor" defaultValue={item?.vendor} placeholder="LDLC" />
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <TextField label={tr("Date d'achat")} name="purchase_date" type="date" defaultValue={item?.purchase_date ?? ""} />
        <TextField label={tr("Prix unitaire (€)")} name="purchase_price" inputMode="decimal" defaultValue={item?.purchase_price ?? ""} />
        <TextField label={tr("Fin de garantie")} name="warranty_until" type="date" defaultValue={item?.warranty_until ?? ""} />
      </div>
      <TextField label={tr("Tags")} name="tags" defaultValue={item?.tags.join(", ")} placeholder={tr("nas, occasion")} hint={tr("Séparés par des virgules")} />
      <TextAreaField label={tr("Notes")} name="notes" defaultValue={item?.notes} rows={3} />
    </FormDialog>
  );
}
