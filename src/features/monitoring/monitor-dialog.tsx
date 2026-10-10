"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { saveMonitorAction } from "@/actions/monitors";
import { FormDialog } from "@/components/ui/form-dialog";
import { Field, inputClass, SelectField, Switch, TextField } from "@/components/ui/form";
import type { Monitor } from "@/lib/data/monitors";

export function MonitorDialog({ monitor, assets }: { monitor?: Monitor; assets: { id: number; label: string }[] }) {
  const [type, setType] = useState<"http" | "tcp">(monitor?.type ?? "http");
  return (
    <FormDialog
      title={monitor ? `Modifier « ${monitor.name} »` : "Nouvelle sonde"}
      description="Contrôlée en continu par l'application : temps de réponse, disponibilité et incidents sont historisés."
      action={saveMonitorAction.bind(null, monitor?.id ?? null)}
      trigger={monitor ? "Modifier" : "Sonde"}
      triggerVariant={monitor ? "secondary" : "primary"}
      triggerIcon={monitor ? <Pencil size={15} /> : <Plus size={16} />}
      triggerLabel={monitor ? "Modifier la sonde" : "Nouvelle sonde"}
    >
      <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
        <TextField label="Nom" name="name" defaultValue={monitor?.name} placeholder="Nextcloud" required />
        <Field label="Type" name="type">
          {(p) => (
            <select {...p} className={inputClass} value={type} onChange={(e) => setType(e.target.value as "http" | "tcp")}>
              <option value="http">HTTP(S)</option>
              <option value="tcp">Port TCP</option>
            </select>
          )}
        </Field>
      </div>
      <TextField
        label={type === "http" ? "URL" : "Hôte:port"}
        name="target"
        defaultValue={monitor?.target}
        placeholder={type === "http" ? "https://cloud.example.fr" : "192.168.10.2:22"}
        required
        className="font-mono"
      />
      <div className="grid gap-5 sm:grid-cols-3">
        <SelectField
          label="Intervalle"
          name="interval_sec"
          defaultValue={monitor?.interval_sec ?? 60}
          options={[30, 60, 120, 300, 600].map((s) => ({ value: s, label: s < 60 ? `${s} s` : `${s / 60} min` }))}
        />
        <SelectField
          label="Délai max"
          name="timeout_ms"
          defaultValue={monitor?.timeout_ms ?? 5000}
          options={[2000, 5000, 10000, 20000].map((ms) => ({ value: ms, label: `${ms / 1000} s` }))}
        />
        <SelectField
          label="Élément lié"
          name="asset_id"
          defaultValue={monitor?.asset_id ?? ""}
          placeholder="—"
          options={assets.map((a) => ({ value: a.id, label: a.label }))}
        />
      </div>
      {type === "http" && (
        <SelectField
          label="Considéré disponible si"
          name="accept"
          defaultValue={monitor?.accept ?? "lt500"}
          options={[
            { value: "lt500", label: "Toute réponse HTTP < 500 (401/403 compris : service derrière authentification)" },
            { value: "2xx3xx", label: "Réponse 2xx ou 3xx uniquement" },
          ]}
        />
      )}
      {type === "tcp" && <input type="hidden" name="accept" value="lt500" />}
      <div className="grid gap-4 sm:grid-cols-2">
        {type === "http" && <Switch name="verify_tls" label="Vérifier le certificat TLS" defaultChecked={!!monitor?.verify_tls} />}
        <Switch name="enabled" label="Sonde active" defaultChecked={monitor ? !!monitor.enabled : true} />
      </div>
    </FormDialog>
  );
}
