"use client";

import { LogIn, UserPlus } from "lucide-react";
import { loginAction, setupAction } from "@/actions/auth";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/form";

export function LoginForm({ next }: { next?: string }) {
  return (
    <ActionForm action={loginAction} className="grid gap-5">
      <input type="hidden" name="next" value={next ?? "/"} />
      <TextField label="Identifiant" name="username" autoComplete="username" autoFocus required />
      <TextField label="Mot de passe" name="password" type="password" autoComplete="current-password" required />
      <SubmitButton pendingLabel="Connexion…" className="mt-2 w-full" icon={<LogIn size={16} />}>
        Se connecter
      </SubmitButton>
    </ActionForm>
  );
}

export function SetupForm() {
  return (
    <ActionForm action={setupAction} className="grid gap-5">
      <TextField label="Identifiant administrateur" name="username" autoComplete="username" autoFocus required hint="3 caractères minimum" />
      <TextField label="Mot de passe" name="password" type="password" autoComplete="new-password" required hint="8 caractères minimum" />
      <TextField label="Confirmation" name="confirm" type="password" autoComplete="new-password" required />
      <SubmitButton pendingLabel="Création…" className="mt-2 w-full" icon={<UserPlus size={16} />}>
        Créer le compte et commencer
      </SubmitButton>
    </ActionForm>
  );
}
