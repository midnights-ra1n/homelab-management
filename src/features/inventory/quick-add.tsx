"use client";

import { Zap } from "lucide-react";
import { useState } from "react";
import { saveAssetAction } from "@/actions/inventory";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField, TextField } from "@/components/ui/form";
import { ASSET_KINDS, ASSET_KIND_META, type AssetKind } from "@/lib/constants";
import type { AssetOption } from "@/lib/data/assets";
import { useT } from "@/i18n/client";
import { NetworkFields, useNetworkState, type SubnetOption } from "./network-fields";

const saveAndStay = saveAssetAction.bind(null, null);

/** Ajout rapide depuis la liste : type, nom, hôte, adresse. Le reste se complète sur la fiche. */
export function QuickAddAsset({ parents, subnets }: { parents: AssetOption[]; subnets: SubnetOption[] }) {
  const tr = useT();
  return (
    <FormDialog
      title={tr("Ajout rapide")}
      description={tr("L'essentiel pour l'inventaire ; tu pourras compléter la fiche ensuite.")}
      action={saveAndStay}
      triggerVariant="secondary"
      triggerIcon={<Zap size={15} />}
      trigger={tr("Ajout rapide")}
      submitLabel="Ajouter à l'inventaire"
    >
      <QuickAddFields parents={parents} subnets={subnets} />
    </FormDialog>
  );
}

/** État local dans les champs : remis à zéro à chaque ouverture (le formulaire est re-monté). */
function QuickAddFields({ parents, subnets }: { parents: AssetOption[]; subnets: SubnetOption[] }) {
  const tr = useT();
  const [kind, setKind] = useState<AssetKind>("vm");
  const net = useNetworkState();
  return (
    <>
      <input type="hidden" name="_stay" value="1" />
      <input type="hidden" name="status" value="online" />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          label={tr("Type")}
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as AssetKind)}
          options={ASSET_KINDS.map((k) => ({ value: k, label: tr(ASSET_KIND_META[k].label) }))}
        />
        <TextField label={tr("Nom d'affichage")} name="display_name" required autoFocus />
        <SelectField
          label={kind === "physical" || kind === "network" ? tr("Rattaché à") : tr("Hôte")}
          name="parent_id"
          placeholder={tr("— Aucun —")}
          defaultValue=""
          onChange={(e) => net.fromHost(parents.find((p) => String(p.id) === e.target.value))}
          options={parents.map((p) => ({ value: p.id, label: `${p.display_name} · ${tr(ASSET_KIND_META[p.kind].label)}` }))}
          className="sm:col-span-2"
        />
        <NetworkFields net={net} subnets={subnets} />
      </div>
    </>
  );
}
