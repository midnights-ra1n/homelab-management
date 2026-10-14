import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Camera, DatabaseBackup, ExternalLink, History, Pencil, SquareTerminal } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getIntegration, type Integration } from "@/lib/data/integrations";
import {
  TIMEFRAMES,
  guestBackups,
  guestConfig,
  guestConsoleUrl,
  guestInterfaces,
  guestRrd,
  guestSnapshots,
  guestStatus,
  nodeTaskList,
  type GuestType,
  type Timeframe,
} from "@/lib/integrations/proxmox";
import { backupNowAction, createSnapshotAction, snapshotCommandAction, updateGuestConfigAction } from "@/actions/proxmox";
import { Badge, Tag } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField, Switch, TextAreaField, TextField } from "@/components/ui/form";
import { Meter } from "@/components/ui/meter";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkTabs } from "@/components/ui/tabs";
import { consoleHref, guestHref, nodeHref } from "@/features/proxmox/console-href";
import { GuestPowerBar } from "@/features/proxmox/guest-power";
import { ApiError, InfoList, PveTable, RrdGrid, TaskTable, TimeframeTabs, attempt } from "@/features/proxmox/pve-ui";
import { dateFormat, formatBytes, formatUptime, pct } from "@/lib/utils";
import { getT } from "@/i18n/server";
import type { Translate } from "@/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Invité Proxmox") };
}

type Props = PageProps<"/[lang]/proxmox/[id]/[node]/[type]/[vmid]">;

const TABS = [
  ["resume", "Résumé"],
  ["materiel", "Matériel & options"],
  ["snapshots", "Snapshots"],
  ["sauvegardes", "Sauvegardes"],
  ["taches", "Tâches"],
] as const;
type Tab = (typeof TABS)[number][0];

export default function GuestPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<Skeleton className="h-[36rem] rounded-2xl" />}>
      <Detail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

type Ctx = { i: Integration; node: string; type: GuestType; vmid: number; tr: Translate };

async function Detail({ params, searchParams }: Props) {
  const tr = await getT();
  await requireUser();
  const p = await params;
  const sp = await searchParams;
  const node = decodeURIComponent(p.node);
  const vmid = Number(p.vmid);
  const type = p.type;
  const i = getIntegration(Number(p.id));
  if (!i || i.type !== "proxmox" || (type !== "qemu" && type !== "lxc") || !Number.isInteger(vmid)) notFound();
  const tab: Tab = TABS.some(([t]) => t === sp.tab) ? (sp.tab as Tab) : "resume";
  const tf: Timeframe = TIMEFRAMES.includes(sp.tf as Timeframe) ? (sp.tf as Timeframe) : "hour";
  const base = guestHref({ integrationId: i.id, node, type, vmid });
  const ctx: Ctx = { i, node, type, vmid, tr };

  const status = await attempt(guestStatus(i, node, type, vmid));
  const s = status.data;
  const name = s?.name ?? `${type === "lxc" ? "CT" : "VM"} ${vmid}`;
  const running = s?.status === "running";

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {name}
            {s && <Badge tone={running ? "green" : s.status === "stopped" ? "muted" : "yellow"} dot>{s.qmpstatus ?? s.status}</Badge>}
            {s?.lock && <Badge tone="yellow">{tr("verrou : {lock}", { lock: s.lock })}</Badge>}
          </span>
        }
        description={`${type === "lxc" ? "CT" : "VM"} ${vmid} · ${node} · ${i.name}`}
        actions={
          <>
            <ButtonLink href={nodeHref(i.id, node)} variant="secondary" icon={<ArrowLeft size={16} />}>
              {node}</ButtonLink>
            {s && <GuestPowerBar integrationId={i.id} node={node} type={type} vmid={vmid} status={s.status} name={name} />}
            {running && (
              <ButtonLink href={consoleHref({ integrationId: i.id, node, type, vmid, name })} variant="secondary" icon={<SquareTerminal size={16} />}>
                {tr("Console")}</ButtonLink>
            )}
            <ButtonLink href={guestConsoleUrl(i.url, type, vmid)} target="_blank" rel="noreferrer" variant="ghost" icon={<ExternalLink size={16} />}>
              {tr("Web UI")}</ButtonLink>
          </>
        }
      />
      {!status.ok ? (
        <ApiError error={status.error} />
      ) : (
        <>
          <LinkTabs label={tr("Sections de l'invité")} active={tab} className="mb-8" items={TABS.map(([v, l]) => ({ value: v, label: tr(l), href: `${base}?tab=${v}` }))} />
          <Suspense key={`${tab}-${tf}`} fallback={<Skeleton className="h-96 rounded-2xl" />}>
            {tab === "resume" && <Summary ctx={ctx} tf={tf} base={base} />}
            {tab === "materiel" && <Hardware ctx={ctx} />}
            {tab === "snapshots" && <Snapshots ctx={ctx} running={running} />}
            {tab === "sauvegardes" && <Backups ctx={ctx} />}
            {tab === "taches" && <Tasks ctx={ctx} />}
          </Suspense>
        </>
      )}
    </>
  );
}

/** Champs cachés qui identifient l'invité dans les formulaires. */
function GuestFields({ ctx }: { ctx: Ctx }) {
  return (
    <>
      <input type="hidden" name="integration_id" value={ctx.i.id} />
      <input type="hidden" name="node" value={ctx.node} />
      <input type="hidden" name="type" value={ctx.type} />
      <input type="hidden" name="vmid" value={ctx.vmid} />
    </>
  );
}

async function Summary({ ctx, tf, base }: { ctx: Ctx; tf: Timeframe; base: string }) {
  const { i, node, type, vmid, tr } = ctx;
  const [status, config, rrd, ifaces] = await Promise.all([
    attempt(guestStatus(i, node, type, vmid)),
    attempt(guestConfig(i, node, type, vmid)),
    attempt(guestRrd(i, node, type, vmid, tf)),
    attempt(guestInterfaces(i, node, type, vmid)),
  ]);
  if (!status.ok) return <ApiError error={status.error} />;
  const s = status.data;
  const c = config.data ?? {};
  const running = s.status === "running";
  const tags = String(c.tags ?? "").split(/[;,\s]+/).filter(Boolean);
  return (
    <div className="grid gap-10">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="grid content-start gap-4 p-5">
          <Meter label="CPU" value={running ? (s.cpu ?? 0) * 100 : 0} detail={running ? `${((s.cpu ?? 0) * 100).toFixed(1)} % · ${s.cpus} vCPU` : `${s.cpus} vCPU`} />
          <Meter label={tr("Mémoire")} value={pct(s.mem ?? 0, s.maxmem ?? 0)} detail={`${formatBytes(s.mem, tr.locale)} / ${formatBytes(s.maxmem, tr.locale)}`} />
          {type === "lxc" && (s.maxswap ?? 0) > 0 && <Meter label="Swap" value={pct(s.swap ?? 0, s.maxswap ?? 0)} detail={`${formatBytes(s.swap, tr.locale)} / ${formatBytes(s.maxswap, tr.locale)}`} />}
          {type === "lxc" ? (
            <Meter label={tr("Disque racine")} value={pct(s.disk ?? 0, s.maxdisk ?? 0)} detail={`${formatBytes(s.disk, tr.locale)} / ${formatBytes(s.maxdisk, tr.locale)}`} />
          ) : (
            <p className="flex justify-between text-xs text-body">
              <span>{tr("Disque de démarrage")}</span>
              <span className="font-mono text-meta">{formatBytes(s.maxdisk, tr.locale)}</span>
            </p>
          )}
        </Card>
        <Card className="p-5 lg:col-span-2">
          <InfoList
            items={[
              [tr("État"), s.qmpstatus ?? s.status],
              [tr("Uptime"), running ? <span key="u" className="font-mono">{formatUptime(s.uptime, tr.locale)}</span> : "—"],
              [tr("Démarrage auto"), c.onboot ? tr("Oui") : tr("Non")],
              [tr("Ordre de démarrage"), c.startup ? <span key="st" className="font-mono">{String(c.startup)}</span> : "—"],
              [tr("Système"), String(c.ostype ?? "—")],
              [tr("Haute disponibilité"), s.ha?.managed ? (s.ha.state ?? tr("Oui")) : tr("Non")],
              ...(type === "qemu"
                ? ([
                    [tr("Agent invité"), c.agent ? tr("Activé") : tr("Désactivé")],
                    [tr("Machine"), <span key="m" className="font-mono">{s["running-machine"] ?? String(c.machine ?? "—")}</span>],
                  ] as [string, React.ReactNode][])
                : []),
              [tr("Lecture / écriture disque"), <span key="io" className="font-mono">{`${formatBytes(s.diskread, tr.locale)} / ${formatBytes(s.diskwrite, tr.locale)}`}</span>],
              [tr("Réseau entrant / sortant"), <span key="n" className="font-mono">{`${formatBytes(s.netin, tr.locale)} / ${formatBytes(s.netout, tr.locale)}`}</span>],
              [tr("Tags"), tags.length ? <span key="t" className="inline-flex flex-wrap justify-end gap-1">{tags.map((t) => <Tag key={t}>{t}</Tag>)}</span> : "—"],
            ]}
          />
        </Card>
      </div>

      <section>
        <SectionTitle>{tr("Adresses IP")}</SectionTitle>
        {!ifaces.ok ? (
          <p className="text-sm text-meta">
            {running ? (type === "qemu" ? tr("Agent invité QEMU injoignable : installe et active qemu-guest-agent pour voir les IP.") : ifaces.error) : tr("L'invité est arrêté.")}
          </p>
        ) : (
          <PveTable
            head={[tr("Interface"), tr("Adresse MAC"), tr("Adresses")]}
            empty={tr("Aucune interface.")}
            rows={ifaces.data.map((n) => [
              <span key="n" className="font-mono font-medium text-h1">{n.name}</span>,
              <span key="h" className="font-mono text-xs">{n.hwaddr ?? "—"}</span>,
              <span key="a" className="font-mono text-xs">{n.addresses.join(" · ") || "—"}</span>,
            ])}
          />
        )}
      </section>

      {c.description && (
        <section>
          <SectionTitle>{tr("Notes")}</SectionTitle>
          <Card className="whitespace-pre-wrap p-5 text-sm leading-relaxed text-body">{String(c.description)}</Card>
        </section>
      )}

      <section>
        <SectionTitle actions={<TimeframeTabs base={`${base}?tab=resume`} active={tf} tr={tr} />}>{tr("Historique")}</SectionTitle>
        {!rrd.ok ? (
          <ApiError error={rrd.error} />
        ) : (
          <RrdGrid
            points={rrd.data}
            series={[
              { title: tr("Utilisation CPU"), key: "cpu", format: "pct", max: 1 },
              { title: tr("Mémoire utilisée"), key: "mem", format: "bytes", max: (p) => p.find((x) => x.maxmem)?.maxmem },
              { title: tr("Réseau entrant"), key: "netin", format: "rate" },
              { title: tr("Réseau sortant"), key: "netout", format: "rate" },
              { title: tr("Lecture disque"), key: "diskread", format: "rate" },
              { title: tr("Écriture disque"), key: "diskwrite", format: "rate" },
            ]}
          />
        )}
      </section>
    </div>
  );
}

async function Hardware({ ctx }: { ctx: Ctx }) {
  const { i, node, type, vmid, tr } = ctx;
  const r = await attempt(guestConfig(i, node, type, vmid));
  if (!r.ok) return <ApiError error={r.error} />;
  const c = r.data;
  const entries = Object.entries(c)
    .filter(([k]) => k !== "digest" && k !== "description")
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  return (
    <section>
      <SectionTitle
        actions={
          <FormDialog title={tr("Modifier la configuration")} description={tr("Les changements de CPU et de mémoire d'un invité démarré s'appliquent au prochain démarrage (sauf hotplug).")} action={updateGuestConfigAction} trigger={tr("Modifier")} triggerIcon={<Pencil size={15} />} triggerVariant="secondary" triggerSize="sm">
            <GuestFields ctx={ctx} />
            <TextField label={type === "qemu" ? tr("Nom") : tr("Nom d'hôte")} name="name" defaultValue={String(c.name ?? c.hostname ?? "")} required />
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField label={tr("Cœurs")} name="cores" type="number" min={1} defaultValue={String(c.cores ?? "")} />
              {type === "qemu" ? (
                <TextField label={tr("Sockets")} name="sockets" type="number" min={1} defaultValue={String(c.sockets ?? 1)} />
              ) : (
                <TextField label={tr("Swap (Mio)")} name="swap" type="number" min={0} defaultValue={String(c.swap ?? 0)} />
              )}
              <TextField label={tr("Mémoire (Mio)")} name="memory" type="number" min={16} defaultValue={String(c.memory ?? "")} />
              <TextField label={tr("Tags")} name="tags" defaultValue={String(c.tags ?? "").replaceAll(";", ", ")} hint={tr("Séparés par des virgules")} />
            </div>
            <Switch name="onboot" label={tr("Démarrer avec le nœud")} defaultChecked={!!c.onboot} />
            <TextAreaField label={tr("Notes")} name="description" defaultValue={String(c.description ?? "")} />
          </FormDialog>
        }
      >
        {tr("Configuration brute ({n} clés)", { n: entries.length })}
      </SectionTitle>
      <PveTable
        head={[tr("Clé"), tr("Valeur")]}
        empty={tr("Configuration vide.")}
        rows={entries.map(([k, v]) => [
          <span key="k" className="whitespace-nowrap font-mono text-xs font-medium text-h1">{k}</span>,
          <span key="v" className="break-all font-mono text-xs text-body">{String(v)}</span>,
        ])}
      />
    </section>
  );
}

async function Snapshots({ ctx, running }: { ctx: Ctx; running: boolean }) {
  const { i, node, type, vmid, tr } = ctx;
  const r = await attempt(guestSnapshots(i, node, type, vmid));
  if (!r.ok) return <ApiError error={r.error} />;
  const snaps = r.data.filter((s) => s.name !== "current").sort((a, b) => (b.snaptime ?? 0) - (a.snaptime ?? 0));
  const fmt = dateFormat(tr.locale, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <section>
      <SectionTitle
        actions={
          <FormDialog title={tr("Prendre un snapshot")} action={createSnapshotAction} trigger={tr("Prendre un snapshot")} triggerIcon={<Camera size={15} />} triggerSize="sm" submitLabel="Prendre le snapshot">
            <GuestFields ctx={ctx} />
            <TextField label={tr("Nom")} name="snapname" required placeholder="avant-maj" />
            <TextAreaField label={tr("Description (facultatif)")} name="description" rows={3} />
            {type === "qemu" && running && <Switch name="vmstate" label={tr("Inclure la RAM")} hint={tr("Permet de revenir à la VM démarrée, mais prend plus de place et de temps.")} />}
          </FormDialog>
        }
      >
        {tr("{n} snapshot(s)", { n: snaps.length })}
      </SectionTitle>
      <PveTable
        head={[tr("Nom"), tr("Date"), tr("RAM"), tr("Description"), ""]}
        align={[undefined, undefined, undefined, undefined, "right"]}
        empty={tr("Aucun snapshot. Le stockage doit les prendre en charge (LVM-thin, ZFS, Ceph, qcow2…).")}
        rows={snaps.map((s) => [
          <span key="n" className="font-mono font-medium text-h1">{s.name}</span>,
          <span key="d" className="whitespace-nowrap text-xs">{s.snaptime ? fmt.format(new Date(s.snaptime * 1000)) : "—"}</span>,
          <span key="r" className="text-xs">{s.vmstate ? tr("Oui") : tr("Non")}</span>,
          <span key="ds" className="text-xs text-body">{s.description?.trim() || "—"}</span>,
          <div key="a" className="flex justify-end gap-0.5">
            <ConfirmButton
              action={snapshotCommandAction.bind(null, i.id, node, type, vmid, s.name, "rollback")}
              icon={<History size={14} />}
              label="Revenir à ce snapshot"
              title="Revenir à ce snapshot ?"
              confirmLabel="Revenir au snapshot"
              pendingLabel="Envoi…"
              message={tr("L'état actuel de {name} sera perdu et remplacé par celui du snapshot « {snap} ».", { name: `${vmid}`, snap: s.name })}
            />
            <ConfirmButton
              action={snapshotCommandAction.bind(null, i.id, node, type, vmid, s.name, "delete")}
              label="Supprimer le snapshot"
              message={tr("Supprimer le snapshot « {snap} » ?", { snap: s.name })}
            />
          </div>,
        ])}
      />
    </section>
  );
}

async function Backups({ ctx }: { ctx: Ctx }) {
  const { i, node, vmid, tr } = ctx;
  const r = await attempt(guestBackups(i, node, vmid));
  if (!r.ok) return <ApiError error={r.error} />;
  const fmt = dateFormat(tr.locale, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <section>
      <SectionTitle
        actions={
          r.data.storages.length > 0 && (
            <FormDialog title={tr("Sauvegarder maintenant")} action={backupNowAction} trigger={tr("Sauvegarder maintenant")} triggerIcon={<DatabaseBackup size={15} />} triggerSize="sm" submitLabel="Lancer la sauvegarde">
              <GuestFields ctx={ctx} />
              <SelectField label={tr("Stockage")} name="storage" options={r.data.storages.map((s) => ({ value: s, label: s }))} />
              <SelectField
                label={tr("Mode")}
                name="mode"
                options={[
                  { value: "snapshot", label: tr("Snapshot (sans interruption)") },
                  { value: "suspend", label: tr("Suspension (courte pause)") },
                  { value: "stop", label: tr("Arrêt (le plus cohérent)") },
                ]}
              />
            </FormDialog>
          )
        }
      >
        {tr("{n} sauvegarde(s)", { n: r.data.backups.length })}
      </SectionTitle>
      <PveTable
        head={[tr("Date"), tr("Stockage"), tr("Fichier"), tr("Notes"), tr("Taille")]}
        align={[undefined, undefined, undefined, undefined, "right"]}
        empty={r.data.storages.length ? tr("Aucune sauvegarde de cet invité.") : tr("Aucun stockage actif n'accepte les sauvegardes (contenu « backup ») sur ce nœud.")}
        rows={r.data.backups.map((b) => [
          <span key="d" className="whitespace-nowrap text-xs">{b.ctime ? fmt.format(new Date(b.ctime * 1000)) : "—"}</span>,
          <span key="s" className="font-mono text-xs">{b.storage}</span>,
          <span key="f" className="break-all font-mono text-xs text-h1">
            {b.volid.split("/").pop()}
            {b.protected ? <Badge tone="blue" className="ml-2">{tr("protégée")}</Badge> : null}
          </span>,
          <span key="n" className="text-xs text-body">{b.notes?.trim() || "—"}</span>,
          formatBytes(b.size, tr.locale),
        ])}
      />
      <p className="mt-3 text-xs text-meta">{tr("La restauration se fait depuis l'interface Proxmox (elle écrase ou crée un invité).")}</p>
    </section>
  );
}

async function Tasks({ ctx }: { ctx: Ctx }) {
  const r = await attempt(nodeTaskList(ctx.i, ctx.node, ctx.vmid));
  return !r.ok ? <ApiError error={r.error} /> : <TaskTable tasks={r.data} tr={ctx.tr} />;
}
