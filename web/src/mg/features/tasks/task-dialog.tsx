
import { Pencil, Plus } from "lucide-react";
import { saveTaskAction } from "@/actions/tasks";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/form";
import { PRIORITIES, PRIORITY_META, TASK_STATUSES, TASK_STATUS_META, type TaskStatus } from "@/lib/constants";
import type { Task } from "@/lib/data/tasks";
import { useT } from "@/i18n/client";

export type TaskOptions = {
  assets: { id: number; display_name: string }[];
  deployments: { id: number; title: string }[];
};

export function TaskDialog({
  task,
  options,
  defaultStatus,
  defaultAsset,
  defaultDeployment,
  label = "Nouvelle tâche",
  variant,
}: {
  task?: Task;
  options: TaskOptions;
  defaultStatus?: TaskStatus;
  defaultAsset?: number;
  defaultDeployment?: number;
  label?: string;
  variant?: "primary" | "ghost" | "icon";
}) {
  const tr = useT();
  label = tr(label);
  const v = variant ?? (task ? "icon" : "primary");
  return (
    <FormDialog
      title={task ? tr("Modifier la tâche") : tr("Nouvelle tâche")}
      action={saveTaskAction.bind(null, task?.id ?? null)}
      trigger={v === "icon" ? undefined : label}
      triggerVariant={v === "icon" ? "subtle" : v}
      triggerSize={v === "icon" ? "icon-sm" : v === "ghost" ? "sm" : "md"}
      triggerIcon={task ? <Pencil size={14} /> : <Plus size={v === "primary" ? 16 : 14} />}
      triggerLabel={task ? tr("Modifier la tâche") : label}
    >
      <TextField label={tr("Titre")} name="title" defaultValue={task?.title} placeholder={tr("Renouveler le certificat wildcard")} required autoFocus />
      <TextAreaField label={tr("Description")} name="description" defaultValue={task?.description} rows={3} />
      <div className="grid gap-5 sm:grid-cols-3">
        <SelectField
          label={tr("Colonne")}
          name="status"
          defaultValue={task?.status ?? defaultStatus ?? "todo"}
          options={TASK_STATUSES.map((s) => ({ value: s, label: tr(TASK_STATUS_META[s].label) }))}
        />
        <SelectField
          label={tr("Priorité")}
          name="priority"
          defaultValue={task?.priority ?? "medium"}
          options={PRIORITIES.map((p) => ({ value: p, label: tr(PRIORITY_META[p].label) }))}
        />
        <TextField label={tr("Échéance")} name="due_date" type="date" defaultValue={task?.due_date ?? ""} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          label={tr("Élément lié")}
          name="asset_id"
          defaultValue={task?.asset_id ?? defaultAsset ?? ""}
          placeholder={tr("— Aucun —")}
          options={options.assets.map((a) => ({ value: a.id, label: a.display_name }))}
        />
        <SelectField
          label={tr("Déploiement lié")}
          name="deployment_id"
          defaultValue={task?.deployment_id ?? defaultDeployment ?? ""}
          placeholder={tr("— Aucun —")}
          options={options.deployments.map((d) => ({ value: d.id, label: d.title }))}
        />
      </div>
      <TextField label={tr("Tags")} name="tags" defaultValue={task?.tags.join(", ")} placeholder={tr("réseau, sécurité")} hint={tr("Séparés par des virgules")} />
    </FormDialog>
  );
}
