"use client";

import { Check, Copy, KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { deleteSshKeyAction, saveSshKeyAction } from "@/actions/ssh-keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/form";
import type { SshKey } from "@/lib/data/ssh-keys";

export function SshKeyDialog() {
  const [mode, setMode] = useState("ed25519");
  return (
    <FormDialog
      title="Nouvelle clé SSH"
      description="Utilisée pour se connecter aux hôtes Webmin. La clé privée est chiffrée en base et ne quitte jamais le serveur."
      action={saveSshKeyAction}
      trigger="Ajouter"
      triggerVariant="ghost"
      triggerSize="sm"
      triggerIcon={<Plus size={14} />}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label="Nom" name="name" placeholder="webmin" required />
        <SelectField
          label="Méthode"
          name="mode"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          options={[
            { value: "ed25519", label: "Générer (Ed25519, recommandé)" },
            { value: "rsa", label: "Générer (RSA 4096)" },
            { value: "import", label: "Importer une clé privée" },
          ]}
        />
      </div>
      {mode === "import" && (
        <TextAreaField
          label="Clé privée"
          name="private_key"
          rows={8}
          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          hint="Format OpenSSH ou PEM, sans passphrase."
          className="font-mono"
          spellCheck={false}
          autoComplete="off"
        />
      )}
    </FormDialog>
  );
}

export function SshKeyList({ keys }: { keys: SshKey[] }) {
  if (!keys.length) {
    return <p className="rounded-xl border border-dashed border-line px-4 py-4 text-center text-sm text-meta">Aucune clé SSH</p>;
  }
  return (
    <ul className="grid gap-2">
      {keys.map((k) => (
        <li key={k.id} className="grid gap-2 rounded-xl border border-line-subtle bg-page px-4 py-3">
          <div className="flex items-center gap-3">
            <KeyRound size={16} className="shrink-0 text-meta" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-h1">{k.name}</span>
            <Badge tone="muted">{k.type.replace(/^ssh-/, "")}</Badge>
            <CopyButton value={k.public_key} />
            <ConfirmButton
              action={deleteSshKeyAction.bind(null, k.id)}
              message={`Supprimer la clé « ${k.name} » ? Les intégrations qui l'utilisent perdront l'accès SSH.`}
            />
          </div>
          {/* Lecture seule et sélectionnable : le presse-papiers n'existe pas en HTTP hors localhost. */}
          <input
            readOnly
            value={k.public_key}
            aria-label={`Clé publique ${k.name}`}
            onFocus={(e) => e.currentTarget.select()}
            className="field w-full rounded-lg px-3 py-1.5 font-mono text-xs"
          />
          <code className="block truncate font-mono text-xs text-meta">{k.fingerprint}</code>
        </li>
      ))}
    </ul>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="subtle"
      size="icon-sm"
      icon={copied ? <Check size={15} /> : <Copy size={15} />}
      aria-label="Copier la clé publique"
      title="Copier la clé publique"
      onClick={async () => {
        await navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    />
  );
}
