"use client";

import { LogIn, UserPlus } from "lucide-react";
import { loginAction, setupAction } from "@/actions/auth";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/form";
import { useT } from "@/i18n/client";

export function LoginForm({ next }: { next?: string }) {
  const tr = useT();
  return (
    <ActionForm action={loginAction} className="grid gap-5">
      <input type="hidden" name="next" value={next ?? "/"} />
      <TextField label={tr("Identifiant")} name="username" autoComplete="username" autoFocus required />
      <TextField label={tr("Mot de passe")} name="password" type="password" autoComplete="current-password" required />
      <SubmitButton pendingLabel={tr("Connexion…")} className="mt-2 w-full" icon={<LogIn size={16} />}>
        {tr("Se connecter")}</SubmitButton>
    </ActionForm>
  );
}

export function SetupForm() {
  const tr = useT();
  return (
    <ActionForm action={setupAction} className="grid gap-5">
      <TextField label={tr("Identifiant administrateur")} name="username" autoComplete="username" autoFocus required hint={tr("3 caractères minimum")} />
      <TextField label={tr("Mot de passe")} name="password" type="password" autoComplete="new-password" required hint={tr("8 caractères minimum")} />
      <TextField label={tr("Confirmation")} name="confirm" type="password" autoComplete="new-password" required />
      <SubmitButton pendingLabel={tr("Création…")} className="mt-2 w-full" icon={<UserPlus size={16} />}>
        {tr("Créer le compte et commencer")}</SubmitButton>
    </ActionForm>
  );
}
