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

const HELP: Record<IntegrationType, string> = {
  proxmox:
    "Datacenter → Permissions → API Tokens. Décoche « Privilege Separation » ou donne au jeton le rôle PVEAuditor (lecture) / PVEVMAdmin (actions) sur « / ».",
  beszel: "Compte utilisateur Beszel (idéalement en lecture seule). L'authentification se fait via l'API PocketBase.",
  maintenant:
    "Maintenant n'a pas d'authentification native : si ton reverse proxy en exige une, renseigne l'en-tête complet (ex. « Authorization: Basic … »).",
  patchmon: "Paramètres → Intégrations → identifiants API avec la portée « host:get ». Authentification Basic (clé + secret).",
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
  const meta = INTEGRATION_META[type];
  const secretHint = integration?.config.has_secret ? "Laisser vide pour conserver la valeur enregistrée" : undefined;
  return (
    <FormDialog
      title={integration ? `Modifier « ${integration.name} »` : `Connecter ${meta.label}`}
      description={meta.description}
      action={saveIntegrationAction.bind(null, integration?.id ?? null)}
      trigger={integration ? undefined : "Ajouter"}
      triggerVariant={integration ? "subtle" : "ghost"}
      triggerSize={integration ? "icon-sm" : "sm"}
      triggerIcon={integration ? <Pencil size={14} /> : <Plus size={14} />}
      triggerLabel={integration ? "Modifier l'intégration" : `Ajouter ${meta.label}`}
      size="lg"
    >
      <input type="hidden" name="type" value={type} />
      <Alert kind="info" title="Où trouver ces informations ?">
        {HELP[type]}
      </Alert>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label="Nom"
          name="name"
          defaultValue={integration?.name}
          placeholder={type === "proxmox" ? "pve-01" : meta.label}
          required
          hint={type === "proxmox" ? "Un nom par nœud (ex. son hostname)" : undefined}
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
              label="ID du jeton"
              name="token_id"
              defaultValue={integration?.config.token_id}
              placeholder="homelab@pve!dashboard"
              required
              className="font-mono"
              autoComplete="off"
            />
            <TextField
              label="Secret du jeton"
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
              label="Clé (token key)"
              name="token_id"
              defaultValue={integration?.config.token_id}
              required
              className="font-mono"
              autoComplete="off"
            />
            <TextField
              label="Secret"
              name="token_secret"
              type="password"
              placeholder={integration?.config.has_secret ? "••••••••" : undefined}
              hint={secretHint}
              autoComplete="new-password"
              className="font-mono"
            />
          </>
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
              label="Mot de passe"
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
              label="Clé SSH"
              name="ssh_key_id"
              defaultValue={integration?.config.ssh_key_id ?? ""}
              placeholder="Aucune (interface web seulement)"
              options={sshKeys.map((k) => ({ value: k.id, label: `${k.name} (${k.type})` }))}
              hint={sshKeys.length ? undefined : "Aucune clé : crée-en une dans Paramètres → Clés SSH"}
            />
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <TextField
                label="Utilisateur SSH"
                name="ssh_user"
                defaultValue={integration?.config.ssh_user}
                placeholder="root"
                className="font-mono"
                autoComplete="off"
              />
              <TextField
                label="Port"
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
                Empreinte de l&apos;hôte mémorisée : {integration.config.ssh_host_key}
              </p>
            )}
          </>
        )}

        {type === "maintenant" && (
          <TextField
            label="En-tête d'authentification (optionnel)"
            name="auth_header"
            type="password"
            placeholder={integration?.config.has_header ? "•••••••• (enregistré)" : "Authorization: Basic dXNlcjpwYXNz"}
            hint={integration?.config.has_header ? "Laisser vide pour conserver l'en-tête enregistré" : "Format « Nom: valeur »"}
            className="font-mono sm:col-span-2"
            autoComplete="off"
          />
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {type !== "webmin" && (
        <Switch
          name="verify_tls"
          label="Vérifier le certificat TLS"
          hint={type === "proxmox" ? "À désactiver pour le certificat auto-signé de Proxmox" : "Désactiver pour un certificat auto-signé"}
          defaultChecked={integration ? !!integration.config.verify_tls : type !== "proxmox"}
        />
        )}
        <Switch name="enabled" label="Activée" defaultChecked={integration ? !!integration.enabled : true} />
        {type === "webmin" && integration?.config.ssh_host_key && (
          <Switch name="reset_host_key" label="Oublier l'empreinte SSH" hint="Après réinstallation de l'hôte" />
        )}
        {type === "maintenant" && integration?.config.has_header && (
          <Switch name="clear_header" label="Supprimer l'en-tête enregistré" />
        )}
      </div>
      <TestConnection id={integration?.id ?? null} />
    </FormDialog>
  );
}

/** Teste la connexion avec les valeurs saisies, sans enregistrer. */
function TestConnection({ id }: { id: number | null }) {
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
          {pending ? "Test en cours…" : "Tester la connexion"}
        </Button>
      </div>
      {result && (
        <Alert kind={result.ok ? "success" : "error"} title={result.ok ? "Connexion réussie" : "Échec de la connexion"}>
          {result.message}
        </Alert>
      )}
    </div>
  );
}
