
import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { saveDeploymentAction } from "@/actions/deployments";
import { Button, ButtonLink } from "@/components/ui/button";
import { ActionForm, Fieldset, FORM_ACTIONS_CLASS, inputClass, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
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
import type { HardwareItem } from "@/lib/data/hardware";
import type { getDeployment } from "@/lib/data/deployments";
import { cn } from "@/lib/utils";
import { STEP_TEMPLATES } from "./templates";
import { KIND_FIELDS } from "./kind-fields";
import { useT } from "@/i18n/client";

type Step = { label: string; done: boolean };

export function DeploymentForm({
  deployment,
  assets,
  hardware,
  subnets,
}: {
  deployment?: NonNullable<Awaited<ReturnType<typeof getDeployment>>>;
  assets: AssetOption[];
  hardware: HardwareItem[];
  subnets: { id: number; name: string; cidr: string }[];
}) {
  const tr = useT();
  const [kind, setKind] = useState<DeploymentKind>(deployment?.kind ?? "vm");
  const [steps, setSteps] = useState<Step[]>(
    // Checklist vide par défaut : le modèle s'ajoute à la demande (« Ajouter la checklist type »).
    deployment?.steps.map((s) => ({ label: s.label, done: !!s.done })) ?? [],
  );
  const [draft, setDraft] = useState("");
  const fields = KIND_FIELDS[kind];
  const machines = hardware.filter((h) => h.category === "server" || h.category === "pc");
  // A stock machine gives its memory and storage: the installed RAM and disks, lots included.
  const total = (m: number, cat: string) =>
    hardware.filter((h) => h.parent_id === m && h.category === cat).reduce((n, h) => n + (h.capacity_gb ?? 0) * h.quantity, 0);

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
      <Fieldset legend={tr("Déploiement")} description={tr("Ce qui doit être déployé, où, et dans quel état il en est.")}>
        <input type="hidden" name="kind" value={kind} />
        <div role="radiogroup" aria-label={tr("Type de déploiement")} className="mb-6 flex flex-wrap gap-2">
          {DEPLOYMENT_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => {
                // Si la checklist est encore celle du modèle précédent (ajoutée à la demande), on la remplace
                const untouched =
                  steps.length > 0 && steps.every((s) => !s.done) && steps.map((s) => s.label).join() === STEP_TEMPLATES[kind].map((l) => tr(l)).join();
                setKind(k);
                if (untouched) setSteps(STEP_TEMPLATES[k].map((label) => ({ label: tr(label), done: false })));
              }}
              className={cn(
                "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                kind === k ? "border-accent bg-accent text-on-accent" : "border-line-strong text-body hover:text-h1",
              )}
            >
              {tr(DEPLOYMENT_KIND_META[k].label)}
            </button>
          ))}
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          <TextField
            label={tr("Titre")}
            name="title"
            defaultValue={deployment?.title}
            placeholder={tr("VM Home Assistant, CT AdGuard…")}
            required
            className="md:col-span-3"
          />
          <SelectField
            label={tr("État")}
            name="status"
            defaultValue={deployment?.status ?? "planned"}
            options={DEPLOYMENT_STATUSES.map((s) => ({ value: s, label: tr(DEPLOYMENT_STATUS_META[s].label) }))}
          />
          <SelectField
            label={tr("Priorité")}
            name="priority"
            defaultValue={deployment?.priority ?? "medium"}
            options={PRIORITIES.map((p) => ({ value: p, label: tr(PRIORITY_META[p].label) }))}
          />
          <TextField label={tr("Date cible")} name="target_date" type="date" defaultValue={deployment?.target_date ?? ""} />
          <TextAreaField
            label={tr("Description")}
            name="description"
            defaultValue={deployment?.description}
            rows={3}
            placeholder={tr("Objectif, contexte, dépendances…")}
            className="md:col-span-3"
          />
          <TextField label={tr("Tags")} name="tags" defaultValue={deployment?.tags.join(", ")} hint={tr("Séparés par des virgules")} className="md:col-span-3" />
        </div>
      </Fieldset>

      <Fieldset legend={tr("Cible & ressources prévues")} description={tr(fields.help)}>
        <div className="grid gap-5 md:grid-cols-3">
          {fields.stock && (
            <SelectField
              key="stock"
              label={tr("Machine du stock")}
              name="hardware_id"
              defaultValue={deployment?.hardware_id ?? ""}
              placeholder={tr("— À choisir —")}
              options={machines.map((m) => ({ value: m.id, label: `${m.name} · ${m.hl_id}` }))}
              hint={machines.length ? undefined : tr("Aucun serveur ni PC dans le stock matériel")}
              onChange={(e) => {
                const m = Number(e.target.value);
                const form = e.currentTarget.form;
                if (!m || !form) return;
                for (const [name, v] of [["planned_ram_gb", total(m, "ram")], ["planned_disk_gb", total(m, "disk")]] as const) {
                  const el = form.elements.namedItem(name) as HTMLInputElement | null;
                  if (el && v) el.value = String(v);
                }
              }}
            />
          )}
          {fields.host && (
            <SelectField
              key={kind}
              label={tr(fields.host.label)}
              name="target_host_id"
              defaultValue={deployment?.target_host_id ?? ""}
              placeholder={tr("— À définir —")}
              options={assets
                .filter((h) => fields.host!.kinds.includes(h.kind))
                .map((h) => ({ value: h.id, label: `${h.display_name} · ${tr(ASSET_KIND_META[h.kind].label)}` }))}
            />
          )}
          <SelectField
            label={tr("Sous-réseau")}
            name="subnet_id"
            defaultValue={deployment?.subnet_id ?? ""}
            placeholder="—"
            options={subnets.map((s) => ({ value: s.id, label: `${s.name} · ${s.cidr}` }))}
          />
          {fields.id && (
            <TextField
              label={tr(fields.id)}
              name="vmid"
              type="number"
              min={1}
              defaultValue={deployment?.vmid ?? ""}
              placeholder="3103"
              className="font-mono"
            />
          )}
          <TextField label={tr("IP prévue")} name="planned_ip" defaultValue={deployment?.planned_ip} placeholder="192.168.10.50" className="font-mono" />
          {fields.cpu && (
            <>
              <TextField label={tr(fields.cpu)} name="planned_cpu" type="number" min={1} defaultValue={deployment?.planned_cpu ?? ""} />
              <TextField label={tr("Mémoire (Go)")} name="planned_ram_gb" type="number" min={0} step="0.5" defaultValue={deployment?.planned_ram_gb ?? ""} />
              <TextField label={tr(fields.disk!)} name="planned_disk_gb" type="number" min={0} defaultValue={deployment?.planned_disk_gb ?? ""} />
            </>
          )}
          <SelectField
            label={tr("Élément d'inventaire lié")}
            name="asset_id"
            defaultValue={deployment?.asset_id ?? ""}
            placeholder={tr("— Pas encore créé —")}
            options={assets.map((a) => ({ value: a.id, label: `${a.display_name} · ${tr(ASSET_KIND_META[a.kind].label)}` }))}
            hint={tr("Renseigné une fois l'élément créé dans l'inventaire")}
            className="md:col-span-3"
          />
        </div>
      </Fieldset>

      <Fieldset legend="Applications & sous-domaines" description={tr("Conteneurs ou applications déployés et leurs entrées de reverse proxy.")}>
        <div className="grid gap-5 md:grid-cols-2">
          <TextAreaField
            label={tr("Conteneurs / apps déployés")}
            name="apps"
            defaultValue={deployment?.apps}
            rows={3}
            placeholder={tr("Technitium, Actual Budget, Memos…\nou « All » / « All (config remain) »")}
            hint={tr("Un par ligne ou séparés par des virgules")}
            className="md:col-span-2"
          />
          <TextField label={tr("FQDN local")} name="local_fqdn" defaultValue={deployment?.local_fqdn} placeholder="nextcloud.lan" className="font-mono" />
          <TextField label={tr("FQDN public")} name="public_fqdn" defaultValue={deployment?.public_fqdn} placeholder="cloud.example.fr" className="font-mono" />
        </div>
      </Fieldset>

      <Fieldset legend={tr("Ce qu'il faut faire")} description={tr("Checklist des étapes. Cocher une étape fait progresser le déploiement.")}>
        <input type="hidden" name="steps" value={JSON.stringify(steps)} />
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<ListChecks size={14} />}
            onClick={() => setSteps([...steps, ...STEP_TEMPLATES[kind].filter((l) => !steps.some((s) => s.label === tr(l))).map((label) => ({ label: tr(label), done: false }))])}
          >
            {tr("Ajouter la checklist type")}</Button>
          {steps.length > 0 && (
            <Button variant="subtle" size="sm" onClick={() => setSteps([])}>
              {tr("Tout retirer")}</Button>
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
                  aria-label={tr("Étape {0} terminée", { "0": i + 1 })}
                />
              </label>
              <span className="w-6 shrink-0 text-center font-mono text-xs text-meta">{String(i + 1).padStart(2, "0")}</span>
              <input
                aria-label={tr("Étape {0}", { "0": i + 1 })}
                className={cn(inputClass, "py-2", s.done && "text-meta line-through")}
                value={s.label}
                onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
              <Button variant="subtle" size="icon-sm" aria-label={tr("Monter")} disabled={i === 0} onClick={() => move(i, -1)} icon={<ArrowUp size={14} />} />
              <Button
                variant="subtle"
                size="icon-sm"
                aria-label={tr("Descendre")}
                disabled={i === steps.length - 1}
                onClick={() => move(i, 1)}
                icon={<ArrowDown size={14} />}
              />
              <Button variant="subtle" size="icon-sm" aria-label={tr("Retirer")} onClick={() => setSteps(steps.filter((_, j) => j !== i))} icon={<Trash2 size={14} />} />
            </li>
          ))}
        </ol>
        <div className="mt-3 flex gap-2">
          <input
            className={inputClass}
            placeholder={tr("Nouvelle étape…")}
            aria-label={tr("Nouvelle étape")}
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
            {tr("Ajouter")}</Button>
        </div>
      </Fieldset>

      <Fieldset legend={tr("Notes")}>
        <TextAreaField label={tr("Notes de déploiement")} name="notes" defaultValue={deployment?.notes} rows={6} placeholder={tr("Commandes, liens de documentation, problèmes rencontrés…")} />
      </Fieldset>

      <div className={FORM_ACTIONS_CLASS}>
        <ButtonLink href={deployment ? `/deploiements/${deployment.id}` : "/deploiements"} variant="secondary">
          {tr("Annuler")}</ButtonLink>
        <SubmitButton>{deployment ? tr("Enregistrer") : tr("Créer le déploiement")}</SubmitButton>
      </div>
    </ActionForm>
  );
}
