"use client";

import { Fingerprint, KeyRound, Plus } from "lucide-react";
import { useState, useSyncExternalStore, useTransition } from "react";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import {
  deletePasskeyAction,
  passkeyLoginAction,
  passkeyLoginOptionsAction,
  passkeyRegisterAction,
  passkeyRegisterOptionsAction,
} from "@/actions/auth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { inputClass } from "@/components/ui/form";
import { useToast } from "@/components/ui/toaster";
import type { Passkey } from "@/lib/passkeys";
import { formatDate, timeAgo } from "@/lib/utils";
import { useT } from "@/i18n/client";

const noop = () => () => {};
/** Passkeys proposées uniquement en HTTPS, avec un navigateur qui sait parser les options JSON. */
function usePasskeySupport() {
  return useSyncExternalStore(
    noop,
    () => location.protocol === "https:" && typeof PublicKeyCredential?.parseRequestOptionsFromJSON === "function",
    () => false,
  );
}

/** Annulation par l'utilisateur ou délai dépassé : pas une erreur à afficher. */
const cancelled = (err: unknown) => err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError");

export function PasskeyLoginButton({ next }: { next?: string }) {
  const tr = useT();
  const supported = usePasskeySupport();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  if (!supported) return null;

  const login = () =>
    start(async () => {
      setError(undefined);
      try {
        const options = await passkeyLoginOptionsAction();
        if (!options) return setError(tr("Les passkeys nécessitent HTTPS."));
        const credential = (await navigator.credentials.get({
          publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options as PublicKeyCredentialRequestOptionsJSON),
        })) as PublicKeyCredential | null;
        if (!credential) return;
        const state = await passkeyLoginAction(credential.toJSON() as AuthenticationResponseJSON, next ?? "/");
        if (state?.message) setError(tr(state.message));
      } catch (err) {
        if (!cancelled(err)) throw err;
      }
    });

  return (
    <div className="mt-5 grid gap-4">
      <div className="flex items-center gap-3 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">
        <span className="h-px flex-1 bg-line-subtle" />
        {tr("ou")}
        <span className="h-px flex-1 bg-line-subtle" />
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <Button variant="secondary" className="w-full" icon={<Fingerprint size={16} />} onClick={login} disabled={pending} aria-busy={pending}>
        {pending ? tr("Connexion…") : tr("Se connecter avec une passkey")}
      </Button>
    </div>
  );
}

export function PasskeyManager({ passkeys }: { passkeys: Passkey[] }) {
  const tr = useT();
  const toast = useToast();
  const supported = usePasskeySupport();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  const add = () =>
    start(async () => {
      try {
        const options = await passkeyRegisterOptionsAction();
        if (!options) return toast("error", tr("Les passkeys nécessitent HTTPS."));
        const credential = (await navigator.credentials.create({
          // Types JSON de la lib et du DOM divergent seulement sur les extensions (non utilisées).
          publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options as PublicKeyCredentialCreationOptionsJSON),
        })) as PublicKeyCredential | null;
        if (!credential) return;
        const state = await passkeyRegisterAction(credential.toJSON() as RegistrationResponseJSON, name);
        toast(state.ok ? "success" : "error", tr(state.message ?? ""));
        if (state.ok) setName("");
      } catch (err) {
        // InvalidStateError : cet appareil a déjà une passkey enregistrée (excludeCredentials).
        if (err instanceof DOMException && err.name === "InvalidStateError") toast("error", tr("Cet appareil a déjà une passkey pour ce compte."));
        else if (!cancelled(err)) toast("error", tr("Enregistrement de la passkey refusé."));
      }
    });

  return (
    <div className="grid gap-4">
      <div>
        <p className="font-medium text-h1">{tr("Passkeys")}</p>
        <p className="mt-1 text-sm text-body">
          {tr("Connexion sans mot de passe par biométrie, code de l'appareil ou clé de sécurité. Disponible uniquement en HTTPS.")}</p>
      </div>
      {passkeys.length > 0 && (
        <ul className="grid gap-2">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl border border-line-subtle bg-page px-4 py-3">
              <KeyRound size={16} className="shrink-0 text-meta" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-h1">{p.name}</span>
                <span className="block font-mono text-xs text-meta">
                  {tr("Ajoutée le {date}", { date: formatDate(p.created_at, tr.locale) })}
                  {" · "}
                  {p.last_used_at ? tr("utilisée {ago}", { ago: timeAgo(p.last_used_at, tr.locale) }) : tr("jamais utilisée")}
                </span>
              </span>
              <ConfirmButton
                action={deletePasskeyAction.bind(null, p.id)}
                message={tr("Supprimer la passkey « {name} » ? Elle ne permettra plus de se connecter.", { name: p.name })}
              />
            </li>
          ))}
        </ul>
      )}
      {supported ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="grid flex-1 gap-1.5 text-sm text-h2">
            {tr("Nom")}
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="MacBook, iPhone, YubiKey…" className={inputClass} />
          </label>
          <Button variant="secondary" icon={<Plus size={15} />} onClick={add} disabled={pending} aria-busy={pending}>
            {pending ? tr("Enregistrement…") : tr("Ajouter une passkey")}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-meta">{tr("Ouvre l'application en HTTPS pour ajouter une passkey.")}</p>
      )}
    </div>
  );
}
