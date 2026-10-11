"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { saveMonitorAction } from "@/actions/monitors";
import { FormDialog } from "@/components/ui/form-dialog";
import { Field, inputClass, SelectField, Switch, TextField } from "@/components/ui/form";
import type { Monitor } from "@/lib/data/monitors";
import { useT } from "@/i18n/client";

export function MonitorDialog({ monitor, assets }: { monitor?: Monitor; assets: { id: number; label: string }[] }) {
  const tr = useT();
  const [type, setType] = useState<"http" | "tcp">(monitor?.type ?? "http");
  return (
    <FormDialog
      title={monitor ? tr("Modifier « {name} »", { name: monitor.name }) : tr("Nouvelle sonde")}
      description={tr("Contrôlée en continu par l'application : temps de réponse, disponibilité et incidents sont historisés.")}
      action={saveMonitorAction.bind(null, monitor?.id ?? null)}
      trigger={monitor ? tr("Modifier") : tr("Sonde")}
      triggerVariant={monitor ? "secondary" : "primary"}
      triggerIcon={monitor ? <Pencil size={15} /> : <Plus size={16} />}
      triggerLabel={monitor ? tr("Modifier la sonde") : tr("Nouvelle sonde")}
    >
      <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
        <TextField label={tr("Nom")} name="name" defaultValue={monitor?.name} placeholder={tr("Nextcloud")} required />
        <Field label={tr("Type")} name="type">
          {(p) => (
            <select {...p} className={inputClass} value={type} onChange={(e) => setType(e.target.value as "http" | "tcp")}>
              <option value="http">{tr("HTTP(S)")}</option>
              <option value="tcp">{tr("Port TCP")}</option>
            </select>
          )}
        </Field>
      </div>
      <TextField
        label={type === "http" ? "URL" : tr("Hôte:port")}
        name="target"
        defaultValue={monitor?.target}
        placeholder={type === "http" ? "https://cloud.example.fr" : "192.168.10.2:22"}
        required
        className="font-mono"
      />
      <div className="grid gap-5 sm:grid-cols-3">
        <SelectField
          label={tr("Intervalle")}
          name="interval_sec"
          defaultValue={monitor?.interval_sec ?? 60}
          options={[30, 60, 120, 300, 600].map((s) => ({ value: s, label: s < 60 ? `${s} s` : `${s / 60} min` }))}
        />
        <SelectField
          label={tr("Délai max")}
          name="timeout_ms"
          defaultValue={monitor?.timeout_ms ?? 5000}
          options={[2000, 5000, 10000, 20000].map((ms) => ({ value: ms, label: `${ms / 1000} s` }))}
        />
        <SelectField
          label={tr("Élément lié")}
          name="asset_id"
          defaultValue={monitor?.asset_id ?? ""}
          placeholder="—"
          options={assets.map((a) => ({ value: a.id, label: a.label }))}
        />
      </div>
      {type === "http" && (
        <SelectField
          label={tr("Considéré disponible si")}
          name="accept"
          defaultValue={monitor?.accept ?? "lt500"}
          options={[
            { value: "lt500", label: tr("Toute réponse HTTP < 500 (401/403 compris : service derrière authentification)") },
            { value: "2xx3xx", label: tr("Réponse 2xx ou 3xx uniquement") },
          ]}
        />
      )}
      {type === "tcp" && <input type="hidden" name="accept" value="lt500" />}
      <div className="grid gap-4 sm:grid-cols-2">
        {type === "http" && <Switch name="verify_tls" label={tr("Vérifier le certificat TLS")} defaultChecked={!!monitor?.verify_tls} />}
        <Switch name="enabled" label={tr("Sonde active")} defaultChecked={monitor ? !!monitor.enabled : true} />
      </div>
    </FormDialog>
  );
}
