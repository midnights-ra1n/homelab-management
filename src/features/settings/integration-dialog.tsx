"use client";

import { Pencil, Plug, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { saveIntegrationAction, testIntegrationAction } from "@/actions/integrations";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField, Switch, TextField } from "@/components/ui/form";
import { INTEGRATION_META, type IntegrationType } from "@/lib/constants";
import type { IntegrationPublic } from "@/lib/data/integrations";
import type { SshKey } from "@/lib/data/ssh-keys";
import { useT } from "@/i18n/client";

const HELP: Record<IntegrationType, string> = {
  proxmox:
    "Datacenter → Permissions → API Tokens. Décoche « Privilege Separation » ou donne au jeton le rôle PVEAuditor (lecture) / PVEVMAdmin (actions) sur « / ».",
  beszel: "Compte utilisateur Beszel (idéalement en lecture seule). L'authentification se fait via l'API PocketBase.",
  maintenant:
    "Maintenant n'a pas d'authentification native : si ton reverse proxy en exige une, renseigne l'en-tête complet (ex. « Authorization: Basic … »).",
  patchmon: "Paramètres → Intégrations → identifiants API avec la portée « host:get ». Authentification Basic (clé + secret).",
  hlm: "Réglages → API : active l'API, puis « Créer un jeton » avec les scopes hosts:read et monitors:read. Les nœuds Proxmox déjà connectés sont reconnus par leur nom : ils ne sont pas comptés deux fois.",
  webmin:
    "URL de l'interface Webmin. Pour l'état système, choisis une clé SSH (Paramètres → Clés SSH) et ajoute sa clé publique dans ~/.ssh/authorized_keys de l'utilisateur. Un compte non-root suffit : tout est en lecture seule.",
};

export function IntegrationDialog({
  type,
  integration,
  sshKeys = [],
}: {
  type: IntegrationType;
  integration?: IntegrationPublic;
  sshKeys?: SshKey[];
}) {
  const tr = useT();
  const meta = INTEGRATION_META[type];
  const secretHint = integration?.config.has_secret ? tr("Laisser vide pour conserver la valeur enregistrée") : undefined;
  return (
    <FormDialog
      title={integration ? tr("Modifier « {name} »", { name: integration.name }) : tr("Connecter {label}", { label: meta.label })}
      description={tr(meta.description)}
      action={saveIntegrationAction.bind(null, integration?.id ?? null)}
      trigger={integration ? undefined : tr("Ajouter")}
      triggerVariant={integration ? "subtle" : "ghost"}
      triggerSize={integration ? "icon-sm" : "sm"}
      triggerIcon={integration ? <Pencil size={14} /> : <Plus size={14} />}
      triggerLabel={integration ? tr("Modifier l'intégration") : tr("Ajouter {label}", { label: meta.label })}
      size="lg"
    >
      <input type="hidden" name="type" value={type} />
      <Alert kind="info" title={tr("Où trouver ces informations ?")}>
        {tr(HELP[type])}
      </Alert>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label={tr("Nom")}
          name="name"
          defaultValue={integration?.name}
          placeholder={type === "proxmox" ? "pve-01" : meta.label}
          required
          hint={type === "proxmox" ? tr("Un nom par nœud (ex. son hostname)") : undefined}
        />
        <TextField
          label="URL"
          name="url"
          type="url"
          defaultValue={integration?.url}
          placeholder={meta.urlPlaceholder}
          required
          className="font-mono"
        />

        {type === "proxmox" && (
          <>
            <TextField
              label={tr("ID du jeton")}
              name="token_id"
              defaultValue={integration?.config.token_id}
              placeholder="homelab@pve!dashboard"
              required
              className="font-mono"
              autoComplete="off"
            />
            <TextField
              label={tr("Secret du jeton")}
              name="token_secret"
              type="password"
              placeholder={integration?.config.has_secret ? "••••••••" : "xxxxxxxx-xxxx-…"}
              hint={secretHint}
              autoComplete="new-password"
              className="font-mono"
            />
          </>
        )}

        {type === "patchmon" && (
          <>
            <TextField
              label={tr("Clé (token key)")}
              name="token_id"
              defaultValue={integration?.config.token_id}
              required
              className="font-mono"
              autoComplete="off"
            />
            <TextField
              label={tr("Secret")}
              name="token_secret"
              type="password"
              placeholder={integration?.config.has_secret ? "••••••••" : undefined}
              hint={secretHint}
              autoComplete="new-password"
              className="font-mono"
            />
          </>
        )}

        {type === "hlm" && (
          <TextField
            label={tr("Jeton d'API")}
            name="token_secret"
            type="password"
            placeholder={integration?.config.has_secret ? "••••••••" : "hlm_…"}
            hint={secretHint}
            required={!integration?.config.has_secret}
            autoComplete="new-password"
            className="font-mono sm:col-span-2"
          />
        )}

        {type === "beszel" && (
          <>
            <TextField
              label="E-mail"
              name="username"
              type="email"
              defaultValue={integration?.config.username}
              placeholder="monitoring@homelab.lan"
              required
              autoComplete="off"
            />
            <TextField
              label={tr("Mot de passe")}
              name="password"
              type="password"
              placeholder={integration?.config.has_secret ? "••••••••" : undefined}
              hint={secretHint}
              autoComplete="new-password"
            />
          </>
        )}

        {type === "webmin" && (
          <>
            <SelectField
              label={tr("Clé SSH")}
              name="ssh_key_id"
              defaultValue={integration?.config.ssh_key_id ?? ""}
              placeholder={tr("Aucune (interface web seulement)")}
              options={sshKeys.map((k) => ({ value: k.id, label: `${k.name} (${k.type})` }))}
              hint={sshKeys.length ? undefined : tr("Aucune clé : crée-en une dans Paramètres → Clés SSH")}
            />
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <TextField
                label={tr("Utilisateur SSH")}
                name="ssh_user"
                defaultValue={integration?.config.ssh_user}
                placeholder="root"
                className="font-mono"
                autoComplete="off"
              />
              <TextField
                label={tr("Port")}
                name="ssh_port"
                type="number"
                min={1}
                max={65535}
                defaultValue={integration?.config.ssh_port ?? 22}
                className="font-mono"
              />
            </div>
            {integration?.config.ssh_host_key && (
              <p className="font-mono text-xs text-meta sm:col-span-2">
                {tr("Empreinte de l'hôte mémorisée : ")}{integration.config.ssh_host_key}
              </p>
            )}
          </>
        )}

        {type === "maintenant" && (
          <TextField
            label={tr("En-tête d'authentification (optionnel)")}
            name="auth_header"
            type="password"
            placeholder={integration?.config.has_header ? tr("•••••••• (enregistré)") : tr("Authorization: Basic dXNlcjpwYXNz")}
            hint={integration?.config.has_header ? tr("Laisser vide pour conserver l'en-tête enregistré") : tr("Format « Nom: valeur »")}
            className="font-mono sm:col-span-2"
            autoComplete="off"
          />
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {type !== "webmin" && (
        <Switch
          name="verify_tls"
          label={tr("Vérifier le certificat TLS")}
          hint={type === "proxmox" ? tr("À désactiver pour le certificat auto-signé de Proxmox") : tr("Désactiver pour un certificat auto-signé")}
          defaultChecked={integration ? !!integration.config.verify_tls : type !== "proxmox"}
        />
        )}
        <Switch name="enabled" label={tr("Activée")} defaultChecked={integration ? !!integration.enabled : true} />
        {type === "webmin" && integration?.config.ssh_host_key && (
          <Switch name="reset_host_key" label={tr("Oublier l'empreinte SSH")} hint={tr("Après réinstallation de l'hôte")} />
        )}
        {type === "maintenant" && integration?.config.has_header && (
          <Switch name="clear_header" label={tr("Supprimer l'en-tête enregistré")} />
        )}
      </div>
      <TestConnection id={integration?.id ?? null} />
    </FormDialog>
  );
}

/** Teste la connexion avec les valeurs saisies, sans enregistrer. */
function TestConnection({ id }: { id: number | null }) {
  const tr = useT();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-3">
      <div>
        <Button
          variant="secondary"
          icon={<Plug size={15} />}
          disabled={pending}
          onClick={(e) => {
            const form = e.currentTarget.form;
            if (!form) return;
            const fd = new FormData(form);
            start(async () => setResult(await testIntegrationAction(id, fd)));
          }}
        >
          {pending ? tr("Test en cours…") : tr("Tester la connexion")}
        </Button>
      </div>
      {result && (
        <Alert kind={result.ok ? "success" : "error"} title={result.ok ? tr("Connexion réussie") : tr("Échec de la connexion")}>
          {result.message}
        </Alert>
      )}
    </div>
  );
}
