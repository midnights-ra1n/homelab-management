import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser, AUTH_DISABLED } from "@/lib/auth";
import { listIntegrations, toPublic } from "@/lib/data/integrations";
import { deleteIntegrationAction } from "@/actions/integrations";
import { DATA_DIR, get } from "@/lib/db";
import { INTEGRATION_META, INTEGRATION_TYPES } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeSwitch } from "@/components/layout/theme-switch";
import { AppIcon } from "@/features/apps/app-icon";
import { IntegrationDialog } from "@/features/settings/integration-dialog";
import { BackupForms, PasswordForm } from "@/features/settings/account-forms";
import { SshKeyDialog, SshKeyList } from "@/features/settings/ssh-keys";
import { listSshKeys } from "@/lib/data/ssh-keys";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Paramètres" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Configuration"
        description="Intégrations Proxmox, monitoring et Webmin, clés SSH, apparence, compte et sauvegardes."
      />
      <Suspense fallback={<Skeleton className="h-[40rem] rounded-2xl" />}>
        <Settings />
      </Suspense>
    </>
  );
}

async function Settings() {
  const user = await requireUser();
  const integrations = listIntegrations().map(toPublic);
  const sshKeys = listSshKeys();
  const counts = get<{ assets: number; ips: number; deployments: number; tasks: number; shortcuts: number }>(
    `SELECT (SELECT COUNT(*) FROM assets) AS assets, (SELECT COUNT(*) FROM ip_addresses) AS ips,
       (SELECT COUNT(*) FROM deployments) AS deployments, (SELECT COUNT(*) FROM tasks) AS tasks,
       (SELECT COUNT(*) FROM shortcuts) AS shortcuts`,
  )!;

  return (
    <div className="grid grid-cols-1 gap-12 xl:gap-16">
      <section id="integrations" aria-labelledby="integrations-title" className="scroll-mt-32">
        <SectionTitle id="integrations-title">Intégrations</SectionTitle>
        <div className="grid gap-4 md:grid-cols-2">
          {INTEGRATION_TYPES.map((type) => {
            const meta = INTEGRATION_META[type];
            const items = integrations.filter((i) => i.type === type);
            return (
              <Card key={type}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-3">
                      <AppIcon type="selfhst" value={meta.icon} name={meta.label} size={26} />
                      {meta.label}
                    </span>
                  }
                  actions={<IntegrationDialog type={type} sshKeys={sshKeys} />}
                />
                <CardBody className="pt-3">
                  <p className="mb-4 text-sm text-body">{meta.description}</p>
                  {items.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-line px-4 py-4 text-center text-sm text-meta">Non connecté</p>
                  ) : (
                    <ul className="grid gap-2">
                      {items.map((i) => (
                        <li key={i.id} className="flex items-center gap-3 rounded-xl border border-line-subtle bg-page px-4 py-2.5">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-h1">{i.name}</span>
                            <span className="block truncate font-mono text-xs text-meta">{i.url}</span>
                          </span>
                          <Badge tone={i.enabled ? "green" : "muted"}>{i.enabled ? "Active" : "Désactivée"}</Badge>
                          <IntegrationDialog type={type} integration={i} sshKeys={sshKeys} />
                          <ConfirmButton
                            action={deleteIntegrationAction.bind(null, i.id)}
                            message={`Supprimer l'intégration « ${i.name} » et ses identifiants ?`}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      </section>

      <section id="ssh" aria-labelledby="ssh-title" className="scroll-mt-32">
        <SectionTitle id="ssh-title">Clés SSH</SectionTitle>
        <Card>
          <CardBody className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-body">Accès aux hôtes Webmin. Les clés privées sont chiffrées en base (AES-256-GCM).</p>
              <SshKeyDialog />
            </div>
            <SshKeyList keys={sshKeys} />
          </CardBody>
        </Card>
      </section>

      <div className="grid gap-6 lg:grid-cols-2 xl:gap-8">
        <section aria-labelledby="appearance">
          <SectionTitle id="appearance">Apparence</SectionTitle>
          <Card>
            <CardBody className="grid gap-4">
              <p className="text-sm text-body">
                Charte <span className="text-accent-text">Midnights Mint</span> : fonds gris-bleu inspirés de Nord, accent menthe #3fbfa6,
                Geist &amp; Geist Mono. « Auto » suit le réglage du système.
              </p>
              <ThemeSwitch className="w-fit" />
            </CardBody>
          </Card>
        </section>

        <section aria-labelledby="about">
          <SectionTitle id="about">À propos</SectionTitle>
          <Card>
            <CardBody>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {[
                  ["Version", process.env.NEXT_PUBLIC_APP_VERSION ?? "1.1.0"],
                  ["Node.js", process.version],
                  ["Données", DATA_DIR],
                  ["Utilisateur", `${user.username}${AUTH_DISABLED ? " (auth. désactivée)" : ""}`],
                  ["Inventaire", `${counts.assets} élément(s) · ${counts.ips} IP`],
                  ["Suivi", `${counts.deployments} déploiement(s) · ${counts.tasks} tâche(s)`],
                ].map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">{k}</dt>
                    <dd className="mt-0.5 truncate font-mono text-h2" title={v}>
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        </section>
      </div>

      {!AUTH_DISABLED && (
        <section aria-labelledby="account">
          <SectionTitle id="account">Compte</SectionTitle>
          <Card>
            <CardBody>
              <PasswordForm />
            </CardBody>
          </Card>
        </section>
      )}

      <section aria-labelledby="data">
        <SectionTitle id="data">Sauvegarde & restauration</SectionTitle>
        <Card>
          <CardBody>
            <BackupForms />
          </CardBody>
        </Card>
        <p className="mt-3 font-mono text-xs text-meta">
          Dernière modification de l&apos;inventaire :{" "}
          {(() => {
            const last = get<{ at: string | null }>("SELECT MAX(updated_at) AS at FROM assets")?.at;
            return last ? timeAgo(last) : "—";
          })()}
        </p>
      </section>
    </div>
  );
}
