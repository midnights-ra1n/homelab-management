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
import { LanguageSwitch, StyleSwitch, ThemeSwitch } from "@/components/layout/theme-switch";
import { AppIcon } from "@/features/apps/app-icon";
import { IntegrationDialog } from "@/features/settings/integration-dialog";
import { BackupForms, PasswordForm } from "@/features/settings/account-forms";
import { PasskeyManager } from "@/features/settings/passkeys";
import { listPasskeys } from "@/lib/passkeys";
import { SshKeyDialog, SshKeyList } from "@/features/settings/ssh-keys";
import { listSshKeys } from "@/lib/data/ssh-keys";
import { getTimeZone, timeZones } from "@/lib/data/settings";
import { TimeZoneSelect } from "@/features/settings/time-zone";
import { timeAgo } from "@/lib/utils";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Paramètres") };
}

export default async function SettingsPage() {
  const tr = await getT();
  return (
    <>
      <PageHeader
        title={tr("Configuration")}
        description={tr("Intégrations Proxmox, monitoring et Webmin, clés SSH, apparence, compte et sauvegardes.")}
      />
      <Suspense fallback={<Skeleton className="h-[40rem] rounded-2xl" />}>
        <Settings />
      </Suspense>
    </>
  );
}

async function Settings() {
  const tr = await getT();
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
        <SectionTitle id="integrations-title">{tr("Intégrations")}</SectionTitle>
        <div className="grid gap-4 md:grid-cols-2">
          {INTEGRATION_TYPES.map((type) => {
            const meta = INTEGRATION_META[type];
            const items = integrations.filter((i) => i.type === type);
            return (
              <Card key={type}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-3">
                      <AppIcon type={meta.icon.startsWith("/") ? "url" : "selfhst"} value={meta.icon} name={tr(meta.label)} size={26} />
                      {tr(meta.label)}
                    </span>
                  }
                  actions={<IntegrationDialog type={type} sshKeys={sshKeys} />}
                />
                <CardBody className="pt-3">
                  <p className="mb-4 text-sm text-body">{tr(meta.description)}</p>
                  {items.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-line px-4 py-4 text-center text-sm text-meta">{tr("Non connecté")}</p>
                  ) : (
                    <ul className="grid gap-2">
                      {items.map((i) => (
                        <li key={i.id} className="flex items-center gap-3 rounded-xl border border-line-subtle bg-page px-4 py-2.5">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-h1">{i.name}</span>
                            <span className="block truncate font-mono text-xs text-meta">{i.url}</span>
                          </span>
                          <Badge tone={i.enabled ? "green" : "muted"}>{i.enabled ? tr("Active") : tr("Désactivée")}</Badge>
                          <IntegrationDialog type={type} integration={i} sshKeys={sshKeys} />
                          <ConfirmButton
                            action={deleteIntegrationAction.bind(null, i.id)}
                            message={tr("Supprimer l'intégration « {name} » et ses identifiants ?", { name: i.name })}
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
        <SectionTitle id="ssh-title">{tr("Clés SSH")}</SectionTitle>
        <Card>
          <CardBody className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-body">{tr("Accès aux hôtes Webmin. Les clés privées sont chiffrées en base (AES-256-GCM).")}</p>
              <SshKeyDialog />
            </div>
            <SshKeyList keys={sshKeys} />
          </CardBody>
        </Card>
      </section>

      <div className="grid gap-8 lg:grid-cols-2 xl:gap-10">
        <section aria-labelledby="appearance">
          <SectionTitle id="appearance">{tr("Apparence")}</SectionTitle>
          <Card>
            <CardBody className="grid gap-4">
              <p className="text-sm text-body">
                {tr("Style Midnights Classic sobre par défaut, ou charte Midnights Mint (accent menthe #3fbfa6, Geist Mono, lueurs). « Auto » suit le réglage clair / sombre du système.")}</p>
              <StyleSwitch className="w-fit" />
              <div className="flex flex-wrap gap-3">
                <ThemeSwitch className="w-fit" />
                <LanguageSwitch className="w-fit" />
              </div>
              <TimeZoneSelect value={getTimeZone()} options={timeZones()} />
            </CardBody>
          </Card>
        </section>

        <section aria-labelledby="about">
          <SectionTitle id="about">{tr("À propos")}</SectionTitle>
          <Card>
            <CardBody>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {[
                  [tr("Version"), process.env.NEXT_PUBLIC_APP_VERSION ?? "1.1.0"],
                  ["Node.js", process.version],
                  [tr("Données"), DATA_DIR],
                  [tr("Utilisateur"), `${user.username}${AUTH_DISABLED ? tr(" (auth. désactivée)") : ""}`],
                  [tr("Inventaire"), tr("{assets} élément(s) · {ips} IP", { assets: counts.assets, ips: counts.ips })],
                  [tr("Suivi"), tr("{deployments} déploiement(s) · {tasks} tâche(s)", { deployments: counts.deployments, tasks: counts.tasks })],
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
          <SectionTitle id="account">{tr("Compte")}</SectionTitle>
          <Card>
            <CardBody className="grid gap-8">
              <PasswordForm />
              <div className="border-t border-line-subtle pt-8">
                <PasskeyManager passkeys={listPasskeys(user.id)} />
              </div>
            </CardBody>
          </Card>
        </section>
      )}

      <section aria-labelledby="data">
        <SectionTitle id="data">{tr("Sauvegarde & restauration")}</SectionTitle>
        <Card>
          <CardBody>
            <BackupForms />
          </CardBody>
        </Card>
        <p className="mt-3 font-mono text-xs text-meta">
          {tr("Dernière modification de l'inventaire :")}{" "}
          {(() => {
            const last = get<{ at: string | null }>("SELECT MAX(updated_at) AS at FROM assets")?.at;
            return last ? timeAgo(last, tr.locale) : "—";
          })()}
        </p>
      </section>
    </div>
  );
}
