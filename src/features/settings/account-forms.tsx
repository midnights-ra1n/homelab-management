"use client";

import { Download, Upload } from "lucide-react";
import { changePasswordAction } from "@/actions/auth";
import { importBackupAction } from "@/actions/backup";
import { ActionForm, Field, SubmitButton, Switch, TextField } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button";

export function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction} resetOnSuccess className="grid gap-5">
      <TextField label="Mot de passe actuel" name="current" type="password" autoComplete="current-password" />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label="Nouveau mot de passe" name="password" type="password" autoComplete="new-password" hint="8 caractères minimum" />
        <TextField label="Confirmation" name="confirm" type="password" autoComplete="new-password" />
      </div>
      <div>
        <SubmitButton>Changer le mot de passe</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function BackupForms() {
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div>
        <p className="font-medium text-h1">Exporter</p>
        <p className="mt-1 text-sm text-body">
          Sauvegarde JSON complète : inventaire, IPAM, déploiements, tâches, raccourcis, icônes et carte.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/api/export" className={buttonClass("primary")}>
            <Download size={15} /> Exporter
          </a>
          <a href="/api/export?secrets=1" className={buttonClass("secondary")}>
            <Download size={15} /> Avec les secrets
          </a>
        </div>
        <p className="mt-3 text-xs text-meta">
          Sans secrets, les jetons d&apos;intégration ne sont pas exportés. Avec secrets, ils sont en clair : conserve le fichier en lieu sûr.
        </p>
      </div>
      <ActionForm action={importBackupAction} resetOnSuccess className="grid content-start gap-4">
        <div>
          <p className="font-medium text-h1">Restaurer</p>
          <p className="mt-1 text-sm text-body">Remplace toutes les données actuelles (le compte administrateur est conservé).</p>
        </div>
        <Field label="Fichier de sauvegarde" name="file">
          {(p) => (
            <input
              {...p}
              type="file"
              accept="application/json,.json"
              className="text-sm text-body file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-box file:px-3 file:py-1.5 file:text-sm file:text-h2"
            />
          )}
        </Field>
        <Switch name="confirm" label="Je confirme le remplacement de toutes les données" />
        <div>
          <SubmitButton variant="danger" icon={<Upload size={15} />} pendingLabel="Restauration…">
            Restaurer
          </SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
