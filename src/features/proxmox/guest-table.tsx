"use client";

import { ArrowRightLeft, ExternalLink, Pause, Play, Power, RotateCw, Search, Square } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { guestActionAction, migrationTargetsAction, remoteMigrateAction } from "@/actions/proxmox";
import { Alert } from "@/components/ui/alert";
import { Badge, Tag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { inputClass } from "@/components/ui/form";
import { Meter } from "@/components/ui/meter";
import { useToast } from "@/components/ui/toaster";
import { cn, formatBytes, formatUptime } from "@/lib/utils";
import { useT } from "@/i18n/client";

export type GuestRow = {
  key: string;
  integrationId: number;
  integrationName: string;
  baseUrl: string;
  node: string;
  type: "qemu" | "lxc";
  vmid: number;
  name: string;
  status: string;
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  uptime: number;
  tags: string[];
};

type Action = "start" | "shutdown" | "stop" | "reboot" | "suspend" | "resume";

const ACTIONS: { action: Action; label: string; icon: typeof Play; when: (s: string) => boolean; danger?: boolean }[] = [
  { action: "start", label: "Démarrer", icon: Play, when: (s) => s === "stopped" },
  { action: "resume", label: "Reprendre", icon: Play, when: (s) => s === "paused" || s === "suspended" },
  { action: "shutdown", label: "Arrêter proprement", icon: Power, when: (s) => s === "running" },
  { action: "reboot", label: "Redémarrer", icon: RotateCw, when: (s) => s === "running" },
  { action: "suspend", label: "Suspendre", icon: Pause, when: (s) => s === "running" },
  { action: "stop", label: "Forcer l'arrêt", icon: Square, when: (s) => s !== "stopped", danger: true },
];

/** Vue agrégée de toutes les VM / CT de tous les nœuds, avec actions et migration. */
export function GuestTable({
  guests,
  integrations,
}: {
  guests: GuestRow[];
  integrations: { id: number; name: string }[];
}) {
  const tr = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "running" | "stopped">("all");
  const [migrating, setMigrating] = useState<GuestRow | null>(null);
  const [confirm, setConfirm] = useState<{ g: GuestRow; action: Action; label: string } | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return guests.filter(
      (g) =>
        (filter === "all" || (filter === "running" ? g.status === "running" : g.status !== "running")) &&
        (!needle || `${g.name} ${g.vmid} ${g.node} ${g.tags.join(" ")}`.toLowerCase().includes(needle)),
    );
  }, [guests, q, filter]);

  const run = (g: GuestRow, action: Action) => {
    setBusy(g.key);
    start(async () => {
      const r = await guestActionAction(g.integrationId, g.node, g.type, g.vmid, action);
      toast(r.ok ? "success" : "error", `${g.name} : ${tr(r.message)}`);
      setBusy(null);
    });
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-meta" aria-hidden="true" />
          <input
            type="search"
            className={cn(inputClass, "pl-10")}
            placeholder={tr("Nom, VMID, nœud, tag…")}
            aria-label={tr("Filtrer les invités")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div role="radiogroup" aria-label={tr("État")} className="inline-flex items-center gap-1 rounded-full border border-line bg-box p-1">
          {(
            [
              ["all", tr("Tous")],
              ["running", tr("Démarrés")],
              ["stopped", tr("Arrêtés")],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={filter === v}
              onClick={() => setFilter(v)}
              className={cn(
                "rounded-full px-3.5 py-1.5 font-mono text-xs transition-colors",
                filter === v ? "bg-accent text-on-accent" : "text-body hover:text-h1",
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Mobile : cartes avec actions principales */}
      <ul className="grid gap-2 md:hidden">
        {rows.map((g) => {
          const running = g.status === "running";
          return (
            <li key={g.key} className={cn("rounded-2xl border border-line-subtle bg-box p-4", busy === g.key && "opacity-60")}>
              <div className="flex items-start gap-3">
                <span
                  className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", running ? "bg-green" : g.status === "stopped" ? "bg-line-strong" : "bg-yellow")}
                  aria-label={g.status}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-h1">{g.name}</p>
                  <p className="font-mono text-xs text-meta">
                    {g.type === "qemu" ? "VM" : "CT"} {g.vmid} · {g.node}
                    {running && ` · ${Math.round(g.cpu * 100)} % CPU · ${formatBytes(g.mem, tr.locale)}`}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {ACTIONS.filter((a) => a.when(g.status) && !(g.type === "lxc" && (a.action === "suspend" || a.action === "resume"))).map((a) => (
                  <Button
                    key={a.action}
                    variant="secondary"
                    size="sm"
                    disabled={pending && busy === g.key}
                    onClick={() => (a.action === "start" || a.action === "resume" ? run(g, a.action) : setConfirm({ g, action: a.action, label: tr(a.label) }))}
                    icon={<a.icon size={13} />}
                  >
                    {tr(a.label)}
                  </Button>
                ))}
                {integrations.length > 1 && (
                  <Button variant="secondary" size="sm" onClick={() => setMigrating(g)} icon={<ArrowRightLeft size={13} />}>
                    {tr("Migrer")}</Button>
                )}
              </div>
            </li>
          );
        })}
        {rows.length === 0 && <li className="py-8 text-center text-sm text-meta">{tr("Aucun invité ne correspond.")}</li>}
      </ul>

      <div className="hidden overflow-hidden rounded-2xl border border-line-subtle bg-box md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] text-left text-sm">
            <thead>
              <tr className="border-b border-line-subtle font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">
                <th className="px-5 py-3 font-medium">{tr("Invité")}</th>
                <th className="px-3 py-3 font-medium">{tr("Nœud")}</th>
                <th className="w-32 px-3 py-3 font-medium">{tr("CPU")}</th>
                <th className="w-40 px-3 py-3 font-medium">{tr("Mémoire")}</th>
                <th className="px-3 py-3 font-medium">{tr("Disque")}</th>
                <th className="px-3 py-3 font-medium">{tr("Uptime")}</th>
                <th className="px-5 py-3 text-right font-medium">{tr("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => {
                const running = g.status === "running";
                return (
                  <tr key={g.key} className={cn("border-b border-line-subtle last:border-0", busy === g.key && "opacity-60")}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className={cn("h-2.5 w-2.5 shrink-0 rounded-full", running ? "bg-green" : g.status === "stopped" ? "bg-line-strong" : "bg-yellow")}
                          title={g.status}
                          aria-label={g.status}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-h1">{g.name}</p>
                          <p className="flex items-center gap-2 font-mono text-xs text-meta">
                            <span>{g.vmid}</span>
                            <Badge tone={g.type === "qemu" ? "blue" : "purple"} className="px-1.5 py-0 text-[0.65rem]">
                              {g.type === "qemu" ? "VM" : "CT"}
                            </Badge>
                            {g.tags.slice(0, 2).map((t) => (
                              <Tag key={t}>{t}</Tag>
                            ))}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-mono text-h2">{g.node}</p>
                      {g.integrationName !== g.node && <p className="text-xs text-meta">{g.integrationName}</p>}
                    </td>
                    <td className="px-3 py-3">
                      {running ? <Meter size="sm" value={g.cpu * 100} detail={`${Math.round(g.cpu * 100)} % · ${g.maxcpu}`} label=" " /> : <span className="text-meta">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      {running ? (
                        <Meter size="sm" value={(g.mem / g.maxmem) * 100} label=" " detail={`${formatBytes(g.mem, tr.locale)} / ${formatBytes(g.maxmem, tr.locale)}`} />
                      ) : (
                        <span className="font-mono text-xs text-meta">{formatBytes(g.maxmem, tr.locale)}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-body">{formatBytes(g.maxdisk, tr.locale)}</td>
                    <td className="px-3 py-3 font-mono text-xs text-body">{running ? formatUptime(g.uptime, tr.locale) : "—"}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-0.5">
                        {ACTIONS.filter((a) => a.when(g.status) && !(g.type === "lxc" && (a.action === "suspend" || a.action === "resume"))).map(
                          (a) => (
                            <Button
                              key={a.action}
                              variant="subtle"
                              size="icon-sm"
                              disabled={pending && busy === g.key}
                              title={tr(a.label)}
                              aria-label={`${tr(a.label)} ${g.name}`}
                              className={a.danger ? "hover:text-red" : undefined}
                              onClick={() =>
                                a.action === "start" || a.action === "resume" ? run(g, a.action) : setConfirm({ g, action: a.action, label: tr(a.label) })
                              }
                              icon={<a.icon size={14} />}
                            />
                          ),
                        )}
                        {integrations.length > 1 && (
                          <Button
                            variant="subtle"
                            size="icon-sm"
                            title={tr("Migrer vers un autre nœud")}
                            aria-label={tr("Migrer {name}", { name: g.name })}
                            onClick={() => setMigrating(g)}
                            icon={<ArrowRightLeft size={14} />}
                          />
                        )}
                        <a
                          href={`${g.baseUrl}/#v1:0:=${g.type}%2F${g.vmid}:4:::::::`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex h-8 w-8 items-center justify-center rounded-full text-body hover:bg-elevated hover:text-h1"
                          title={tr("Ouvrir dans Proxmox")}
                          aria-label={tr("Ouvrir {name} dans Proxmox", { name: g.name })}
                        >
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-meta">
                    {tr("Aucun invité ne correspond.")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title={confirm ? `${confirm.label} ?` : ""} size="sm">
        {confirm && (
          <>
            <p className="text-sm text-body">
              {confirm.label} <strong className="text-h1">{confirm.g.name}</strong> ({confirm.g.vmid}{tr(") sur ")}{confirm.g.node}.
              {confirm.action === "stop" && tr(" L'arrêt forcé équivaut à couper l'alimentation.")}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setConfirm(null)}>
                {tr("Annuler")}</Button>
              <Button
                variant={confirm.action === "stop" ? "danger" : "primary"}
                onClick={() => {
                  run(confirm.g, confirm.action);
                  setConfirm(null);
                }}
              >
                {confirm.label}
              </Button>
            </div>
          </>
        )}
      </Dialog>

      <MigrateDialog guest={migrating} integrations={integrations} onClose={() => setMigrating(null)} />
    </div>
  );
}

function MigrateDialog({
  guest,
  integrations,
  onClose,
}: {
  guest: GuestRow | null;
  integrations: { id: number; name: string }[];
  onClose: () => void;
}) {
  const tr = useT();
  const toast = useToast();
  const [targetId, setTargetId] = useState<string>("");
  const [targets, setTargets] = useState<{ storages: { storage: string; avail: number | null }[]; bridges: string[]; node: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storage, setStorage] = useState("");
  const [bridge, setBridge] = useState("");
  const [online, setOnline] = useState(true);
  const [del, setDel] = useState(false);
  const [vmid, setVmid] = useState("");
  const [loading, startLoad] = useTransition();
  const [submitting, startSubmit] = useTransition();

  const candidates = integrations.filter((i) => i.id !== guest?.integrationId);

  const loadTargets = (id: string) => {
    setTargetId(id);
    setTargets(null);
    setError(null);
    if (!id) return;
    startLoad(async () => {
      const r = await migrationTargetsAction(Number(id));
      if (!r.ok) setError(r.message);
      else {
        setTargets(r);
        setStorage(r.storages[0]?.storage ?? "");
        setBridge(r.bridges.includes("vmbr0") ? "vmbr0" : (r.bridges[0] ?? ""));
      }
    });
  };

  return (
    <Dialog
      open={!!guest}
      onClose={() => {
        onClose();
        setTargetId("");
        setTargets(null);
        setError(null);
      }}
      title={guest ? tr("Migrer {name}", { name: guest.name }) : ""}
      description={guest ? tr("{type} {vmid} · depuis {node}", { type: guest.type === "qemu" ? "VM" : "CT", vmid: guest.vmid, node: guest.node }) : undefined}
    >
      {guest && (
        <div className="grid gap-5">
          <Alert kind="warning" title={tr("Migration distante (expérimental)")}>
            {tr("Utilise ")}<code className="font-mono text-xs">{tr("remote-migrate")}</code> {tr("de Proxmox VE ≥ 7.3 entre nœuds hors cluster. Le jeton de la cible doit avoir les droits ")}<code className="font-mono text-xs">{tr("Sys.Incoming")}</code>{tr(", VM.* et Datastore.* ; celui de la source ")}<code className="font-mono text-xs">{tr("VM.Migrate")}</code>.
          </Alert>
          <div>
            <label htmlFor="mig-target" className="mb-2 block text-sm font-medium text-h1">
              {tr("Nœud cible")}</label>
            <select id="mig-target" className={inputClass} value={targetId} onChange={(e) => loadTargets(e.target.value)}>
              <option value="">{tr("— Choisir —")}</option>
              {candidates.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
          {loading && <p className="text-sm text-meta">{tr("Lecture des stockages et bridges de la cible…")}</p>}
          {error && <Alert kind="error">{error}</Alert>}
          {targets && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="mig-storage" className="mb-2 block text-sm font-medium text-h1">
                  {tr("Stockage cible")}</label>
                <select id="mig-storage" className={inputClass} value={storage} onChange={(e) => setStorage(e.target.value)}>
                  {targets.storages.map((s) => (
                    <option key={s.storage} value={s.storage}>
                      {s.storage}
                      {s.avail ? tr(" · {size} libres", { size: formatBytes(s.avail, tr.locale) }) : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="mig-bridge" className="mb-2 block text-sm font-medium text-h1">
                  {tr("Bridge réseau cible")}</label>
                <select id="mig-bridge" className={inputClass} value={bridge} onChange={(e) => setBridge(e.target.value)}>
                  {targets.bridges.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="mig-vmid" className="mb-2 block text-sm font-medium text-h1">
                  {tr("VMID cible")}</label>
                <input
                  id="mig-vmid"
                  className={cn(inputClass, "font-mono")}
                  type="number"
                  min={100}
                  placeholder={String(guest.vmid)}
                  value={vmid}
                  onChange={(e) => setVmid(e.target.value)}
                />
                <p className="mt-2 text-xs text-meta">{tr("Vide = conserver ")}{guest.vmid}</p>
              </div>
              <div className="grid content-start gap-3 pt-7">
                <label className="flex items-center gap-2.5 text-sm text-h2">
                  <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} className="h-4 w-4 accent-[var(--mm-accent)]" />
                  {guest.type === "qemu" ? tr("Migration à chaud (online)") : tr("Redémarrer le CT (restart)")}
                </label>
                <label className="flex items-center gap-2.5 text-sm text-h2">
                  <input type="checkbox" checked={del} onChange={(e) => setDel(e.target.checked)} className="h-4 w-4 accent-[var(--mm-accent)]" />
                  {tr("Supprimer la source après succès")}</label>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              {tr("Annuler")}</Button>
            <Button
              disabled={!targets || !storage || !bridge || submitting}
              onClick={() =>
                startSubmit(async () => {
                  const r = await remoteMigrateAction({
                    sourceId: guest.integrationId,
                    sourceNode: guest.node,
                    type: guest.type,
                    vmid: guest.vmid,
                    targetId: Number(targetId),
                    targetStorage: storage,
                    targetBridge: bridge,
                    targetVmid: vmid ? Number(vmid) : null,
                    online,
                    deleteSource: del,
                  });
                  toast(r.ok ? "success" : "error", r.message);
                  if (r.ok) onClose();
                })
              }
              icon={<ArrowRightLeft size={15} />}
            >
              {submitting ? tr("Lancement…") : tr("Lancer la migration")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
