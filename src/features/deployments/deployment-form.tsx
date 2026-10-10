"use client";

import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { saveDeploymentAction } from "@/actions/deployments";
import { Button, ButtonLink } from "@/components/ui/button";
import { ActionForm, Fieldset, inputClass, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import {
  ASSET_KIND_META,
  DEPLOYMENT_KINDS,
  DEPLOYMENT_KIND_META,
  DEPLOYMENT_STATUSES,
  DEPLOYMENT_STATUS_META,
  PRIORITIES,
  PRIORITY_META,
  type DeploymentKind,
} from "@/lib/constants";
import type { AssetOption } from "@/lib/data/assets";
import type { getDeployment } from "@/lib/data/deployments";
import { cn } from "@/lib/utils";
import { STEP_TEMPLATES } from "./templates";

type Step = { label: string; done: boolean };

export function DeploymentForm({
  deployment,
  hosts,
  assets,
  subnets,
}: {
  deployment?: NonNullable<ReturnType<typeof getDeployment>>;
  hosts: AssetOption[];
  assets: AssetOption[];
  subnets: { id: number; name: string; cidr: string }[];
}) {
  const [kind, setKind] = useState<DeploymentKind>(deployment?.kind ?? "vm");
  const [steps, setSteps] = useState<Step[]>(
    deployment?.steps.map((s) => ({ label: s.label, done: !!s.done })) ?? STEP_TEMPLATES.vm.map((label) => ({ label, done: false })),
  );
  const [draft, setDraft] = useState("");

  const addDraft = () => {
    if (!draft.trim()) return;
    setSteps([...steps, { label: draft.trim(), done: false }]);
    setDraft("");
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...steps];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setSteps(next);
  };

  return (
    <ActionForm action={saveDeploymentAction.bind(null, deployment?.id ?? null)} className="grid grid-cols-1 gap-6">
      <Fieldset legend="Déploiement" description="Ce qui doit être déployé, où, et dans quel état il en est.">
        <input type="hidden" name="kind" value={kind} />
        <div role="radiogroup" aria-label="Type de déploiement" className="mb-6 flex flex-wrap gap-2">
          {DEPLOYMENT_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => {
                // Si la checklist est encore celle du modèle précédent, on la remplace
                const untouched =
                  steps.every((s) => !s.done) && steps.map((s) => s.label).join() === STEP_TEMPLATES[kind].join();
                setKind(k);
                if (untouched || steps.length === 0) setSteps(STEP_TEMPLATES[k].map((label) => ({ label, done: false })));
              }}
              className={cn(
                "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                kind === k ? "border-accent bg-accent text-on-accent" : "border-line-strong text-body hover:text-h1",
              )}
            >
              {DEPLOYMENT_KIND_META[k].label}
            </button>
          ))}
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          <TextField
            label="Titre"
            name="title"
            defaultValue={deployment?.title}
            placeholder="VM Home Assistant, CT AdGuard…"
            required
            className="md:col-span-3"
          />
          <SelectField
            label="État"
            name="status"
            defaultValue={deployment?.status ?? "planned"}
            options={DEPLOYMENT_STATUSES.map((s) => ({ value: s, label: DEPLOYMENT_STATUS_META[s].label }))}
          />
          <SelectField
            label="Priorité"
            name="priority"
            defaultValue={deployment?.priority ?? "medium"}
            options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label }))}
          />
          <TextField label="Date cible" name="target_date" type="date" defaultValue={deployment?.target_date ?? ""} />
          <TextAreaField
            label="Description"
            name="description"
            defaultValue={deployment?.description}
            rows={3}
            placeholder="Objectif, contexte, dépendances…"
            className="md:col-span-3"
          />
          <TextField label="Tags" name="tags" defaultValue={deployment?.tags.join(", ")} hint="Séparés par des virgules" className="md:col-span-3" />
        </div>
      </Fieldset>

      <Fieldset legend="Cible & ressources prévues" description="Où sera déployé l'élément et ce qu'il consommera.">
        <div className="grid gap-5 md:grid-cols-3">
          <SelectField
            label="Hôte / nœud cible"
            name="target_host_id"
            defaultValue={deployment?.target_host_id ?? ""}
            placeholder="— À définir —"
            options={hosts.map((h) => ({ value: h.id, label: `${h.display_name} · ${ASSET_KIND_META[h.kind].label}` }))}
          />
          <SelectField
            label="Sous-réseau"
            name="subnet_id"
            defaultValue={deployment?.subnet_id ?? ""}
            placeholder="—"
            options={subnets.map((s) => ({ value: s.id, label: `${s.name} · ${s.cidr}` }))}
          />
          <TextField
            label="ID (VMID)"
            name="vmid"
            type="number"
            min={1}
            defaultValue={deployment?.vmid ?? ""}
            placeholder="3103"
            className="font-mono"
          />
          <TextField label="IP prévue" name="planned_ip" defaultValue={deployment?.planned_ip} placeholder="192.168.10.50" className="font-mono" />
          <TextField label="vCPU / cœurs" name="planned_cpu" type="number" min={1} defaultValue={deployment?.planned_cpu ?? ""} />
          <TextField label="Mémoire (Go)" name="planned_ram_gb" type="number" min={0} step="0.5" defaultValue={deployment?.planned_ram_gb ?? ""} />
          <TextField label="Disque (Go)" name="planned_disk_gb" type="number" min={0} defaultValue={deployment?.planned_disk_gb ?? ""} />
          <SelectField
            label="Élément d'inventaire lié"
            name="asset_id"
            defaultValue={deployment?.asset_id ?? ""}
            placeholder="— Pas encore créé —"
            options={assets.map((a) => ({ value: a.id, label: `${a.display_name} · ${ASSET_KIND_META[a.kind].label}` }))}
            hint="Renseigné une fois l'élément créé dans l'inventaire"
            className="md:col-span-3"
          />
        </div>
      </Fieldset>

      <Fieldset legend="Applications & sous-domaines" description="Conteneurs ou applications déployés et leurs entrées de reverse proxy.">
        <div className="grid gap-5 md:grid-cols-2">
          <TextAreaField
            label="Conteneurs / apps déployés"
            name="apps"
            defaultValue={deployment?.apps}
            rows={3}
            placeholder={"Technitium, Actual Budget, Memos…\nou « All » / « All (config remain) »"}
            hint="Un par ligne ou séparés par des virgules"
            className="md:col-span-2"
          />
          <TextField label="FQDN local" name="local_fqdn" defaultValue={deployment?.local_fqdn} placeholder="nextcloud.lan" className="font-mono" />
          <TextField label="FQDN public" name="public_fqdn" defaultValue={deployment?.public_fqdn} placeholder="cloud.example.fr" className="font-mono" />
        </div>
      </Fieldset>

      <Fieldset legend="Ce qu'il faut faire" description="Checklist des étapes. Cocher une étape fait progresser le déploiement.">
        <input type="hidden" name="steps" value={JSON.stringify(steps)} />
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<ListChecks size={14} />}
            onClick={() => setSteps([...steps, ...STEP_TEMPLATES[kind].filter((l) => !steps.some((s) => s.label === l)).map((label) => ({ label, done: false }))])}
          >
            Ajouter la checklist type
          </Button>
          {steps.length > 0 && (
            <Button variant="subtle" size="sm" onClick={() => setSteps([])}>
              Tout retirer
            </Button>
          )}
        </div>
        <ol className="grid gap-2">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2 rounded-xl border border-line-subtle bg-page p-2">
              <label className="flex cursor-pointer items-center px-1">
                <input
                  type="checkbox"
                  checked={s.done}
                  onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))}
                  className="h-4 w-4 accent-[var(--mm-accent)]"
                  aria-label={`Étape ${i + 1} terminée`}
                />
              </label>
              <span className="w-6 shrink-0 text-center font-mono text-xs text-meta">{String(i + 1).padStart(2, "0")}</span>
              <input
                aria-label={`Étape ${i + 1}`}
                className={cn(inputClass, "py-2", s.done && "text-meta line-through")}
                value={s.label}
                onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
              <Button variant="subtle" size="icon-sm" aria-label="Monter" disabled={i === 0} onClick={() => move(i, -1)} icon={<ArrowUp size={14} />} />
              <Button
                variant="subtle"
                size="icon-sm"
                aria-label="Descendre"
                disabled={i === steps.length - 1}
                onClick={() => move(i, 1)}
                icon={<ArrowDown size={14} />}
              />
              <Button variant="subtle" size="icon-sm" aria-label="Retirer" onClick={() => setSteps(steps.filter((_, j) => j !== i))} icon={<Trash2 size={14} />} />
            </li>
          ))}
        </ol>
        <div className="mt-3 flex gap-2">
          <input
            className={inputClass}
            placeholder="Nouvelle étape…"
            aria-label="Nouvelle étape"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addDraft();
              }
            }}
          />
          <Button variant="secondary" onClick={addDraft} icon={<Plus size={15} />}>
            Ajouter
          </Button>
        </div>
      </Fieldset>

      <Fieldset legend="Notes">
        <TextAreaField label="Notes de déploiement" name="notes" defaultValue={deployment?.notes} rows={6} placeholder="Commandes, liens de documentation, problèmes rencontrés…" />
      </Fieldset>

      <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 flex justify-end xl:bottom-4 xl:mr-16 2xl:mr-0 gap-3 rounded-full border border-line bg-page/90 p-2 backdrop-blur">
        <ButtonLink href={deployment ? `/deploiements/${deployment.id}` : "/deploiements"} variant="secondary">
          Annuler
        </ButtonLink>
        <SubmitButton>{deployment ? "Enregistrer" : "Créer le déploiement"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
