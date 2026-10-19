
import { Download, Upload } from "lucide-react";
import { changePasswordAction } from "@/actions/auth";
import { importBackupAction } from "@/actions/backup";
import { ActionForm, Field, SubmitButton, Switch, TextField } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button";
import { useT } from "@/i18n/client";

export function PasswordForm() {
  const tr = useT();
  return (
    <ActionForm action={changePasswordAction} resetOnSuccess className="grid gap-5">
      <TextField label={tr("Mot de passe actuel")} name="current" type="password" autoComplete="current-password" />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label={tr("Nouveau mot de passe")} name="password" type="password" autoComplete="new-password" hint={tr("12 caractères minimum")} />
        <TextField label={tr("Confirmation")} name="confirm" type="password" autoComplete="new-password" />
      </div>
      <div>
        <SubmitButton>{tr("Changer le mot de passe")}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function BackupForms() {
  const tr = useT();
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div>
        <p className="font-medium text-h1">{tr("Exporter")}</p>
        <p className="mt-1 text-sm text-body">
          {tr("Sauvegarde JSON complète : inventaire, IPAM, déploiements, tâches, raccourcis, icônes et carte.")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {/* Téléchargement d'un Route Handler, pas une page : la règle confond /api avec /[lang]. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/mg/export" className={buttonClass("primary")}>
            <Download size={15} /> {tr("Exporter")}</a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/mg/export?secrets=1" className={buttonClass("secondary")}>
            <Download size={15} /> {tr("Avec les secrets")}</a>
        </div>
        <p className="mt-3 text-xs text-meta">
          {tr("Sans secrets, les jetons d'intégration ne sont pas exportés. Avec secrets, ils sont en clair : conserve le fichier en lieu sûr.")}</p>
      </div>
      <ActionForm action={importBackupAction} resetOnSuccess className="grid content-start gap-4">
        <div>
          <p className="font-medium text-h1">{tr("Restaurer")}</p>
          <p className="mt-1 text-sm text-body">{tr("Remplace toutes les données actuelles (le compte administrateur est conservé).")}</p>
        </div>
        <Field label={tr("Fichier de sauvegarde")} name="file">
          {(p) => (
            <input
              {...p}
              type="file"
              accept="application/json,.json"
              className="text-sm text-body file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-box file:px-3 file:py-1.5 file:text-sm file:text-h2"
            />
          )}
        </Field>
        <Switch name="confirm" label={tr("Je confirme le remplacement de toutes les données")} />
        <div>
          <SubmitButton variant="danger" icon={<Upload size={15} />} pendingLabel={tr("Restauration…")}>
            {tr("Restaurer")}</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
