/* Notifications menu of both UIs: open alerts, hosts with pending updates and update reminders.
   Each role gives its own feed (alerts and hosts); the reminders live on /api/reminders in both. */
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowUpRight, Bell, BellPlus, Check, PackageCheck, Trash2 } from "lucide-react";
import { api } from "../api";
import { Popover } from "../mg/components/ui/popover";
import { refreshPolled, usePolled } from "./poll";
import { Badge, Button, Link, Segmented, StatusIcon, TONE_VAR, cn, inputClass } from "../ui";

export type NotifAlert = { key: string; critical: boolean; text: string; detail?: string; href: string };
/** A host as seen by the monitoring; `key` is saved with its reminders, `href` opens its updates. */
export type NotifHost = { key: string; name: string; pending: number; security: number; reboot: boolean; href: string };
export type NotifFeed = { alerts: NotifAlert[]; hosts: NotifHost[] };

type Reminder = { id: number; host: string; host_ref: string; due_date: string; repeat_days: number; note: string; due: boolean };
type Reminders = { today: string; reminders: Reminder[] };
type Tab = "alerts" | "updates" | "reminders";

const REMINDERS = "/api/reminders";
const REPEATS: [number, string][] = [[0, "Une fois"], [7, "Chaque semaine"], [14, "Toutes les 2 semaines"], [30, "Chaque mois"], [90, "Chaque trimestre"]];

const needsUpdate = (h: NotifHost) => h.pending > 0 || h.reboot;
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const plusDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00`);
  t.setDate(t.getDate() + n);
  return t.toLocaleDateString("sv-SE"); // YYYY-MM-DD
};

/** Internal page or monitoring hub of another server (new tab). */
function Go({ to, onClick, className, children }: { to: string; onClick: () => void; className: string; children: ReactNode }) {
  return /^https?:/.test(to)
    ? <a href={to} target="_blank" rel="noreferrer" onClick={onClick} className={className}>{children}</a>
    : <Link to={to} onClick={onClick} className={className}>{children}</Link>;
}

/**
 * Sidebar entry above Settings (or round button at the top of the page on mobile, `floating`):
 * the badge counts open alerts, hosts to update and due reminders; the menu details each.
 */
export function NotificationsMenu<T>({ url, toFeed, floating = false, alertsLink, updatesLink }: {
  /** Polled feed of the role, shared with its alert strip; `toFeed` must be a stable function. */
  url: string;
  toFeed: (data: T) => NotifFeed;
  floating?: boolean;
  alertsLink: [href: string, label: string];
  updatesLink: [href: string, label: string];
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);
  const [preset, setPreset] = useState("");
  const ref = useRef<HTMLButtonElement>(null);
  const data = usePolled<T>(url);
  const { alerts, hosts } = useMemo(() => (data ? toFeed(data) : { alerts: [], hosts: [] }), [data, toFeed]);
  const rem = usePolled<Reminders>(REMINDERS) ?? null;

  const updates = hosts.filter(needsUpdate).sort((a, b) => b.security - a.security || Number(b.reboot) - Number(a.reboot) || b.pending - a.pending || a.name.localeCompare(b.name, "fr"));
  const due = rem?.reminders.filter((r) => r.due) ?? [];
  const count = alerts.length + updates.length + due.length;
  const critical = alerts.some((a) => a.critical);
  const warn = alerts.length > 0 || updates.some((h) => h.security > 0) || due.some((r) => r.due_date < (rem?.today ?? ""));
  const color = TONE_VAR[critical ? "red" : warn ? "yellow" : "accent"];
  const shown: Tab = tab ?? (alerts.length ? "alerts" : updates.length ? "updates" : due.length ? "reminders" : "alerts");
  const label = count ? `Notifications : ${count} en cours` : "Notifications";
  const close = () => setOpen(false);

  return (
    <>
      <button ref={ref} type="button" aria-haspopup="dialog" aria-expanded={open} title={label} aria-label={label} onClick={() => setOpen((o) => !o)}
        className={floating ? "mm-btn mm-btn--secondary mm-btn--icon mm-notify-fab sm:hidden" : "mm-nav-item mm-nav-item--notify"}>
        <Bell size={16} aria-hidden="true" className="shrink-0" />
        {!floating && <span className="mm-nav-item__label">Notifications</span>}
        {count > 0 && <span className={cn("mm-nav-item__count", floating && "absolute -right-1 -top-1")} style={{ background: color, color: "var(--mm-surface)" }}>{count}</span>}
      </button>
      <Popover open={open} onClose={close} anchorRef={ref} align={floating ? "end" : "start"} label="Notifications" className="w-[min(400px,calc(100vw-16px))]">
        <div className="p-1.5 pb-2">
          <Segmented<Tab> size="sm" label="Type de notification" value={shown} onChange={setTab} className="w-full"
            options={[
              ["alerts", <>Alertes{alerts.length > 0 && <Count n={alerts.length} />}</>],
              ["updates", <>Mises à jour{updates.length > 0 && <Count n={updates.length} />}</>],
              ["reminders", <>Rappels{due.length > 0 && <Count n={due.length} />}</>],
            ]} />
        </div>
        {shown === "alerts" && (
          <>
            {alerts.length ? alerts.map((a) => (
              <Go key={a.key} to={a.href} onClick={close} className="mm-menu__item no-underline">
                <StatusIcon kind={a.critical ? "down" : "warn"} size={15} />
                <span className="truncate">{a.text}{a.detail ? <span className="text-meta"> · {a.detail}</span> : null}</span>
              </Go>
            )) : <Empty>Aucune alerte en cours.</Empty>}
            <Footer to={alertsLink[0]} onClick={close}>{alertsLink[1]}</Footer>
          </>
        )}
        {shown === "updates" && (
          <UpdatesPanel hosts={updates} onClose={close} link={updatesLink}
            onRemind={(key) => { setPreset(key); setTab("reminders"); }} />
        )}
        {shown === "reminders" && (
          <RemindersPanel rem={rem} hosts={hosts} preset={preset} />
        )}
      </Popover>
    </>
  );
}

function Count({ n }: { n: number }) {
  return <span className="font-mono text-[11px] tabular-nums text-meta">{n}</span>;
}

function Empty({ children }: { children: string }) {
  return <p className="px-2.5 py-2 text-sm text-meta">{children}</p>;
}

function Footer({ to, onClick, children }: { to: string; onClick: () => void; children: string }) {
  return (
    <>
      <div className="mm-menu__sep" role="separator" />
      <Link to={to} onClick={onClick} className="mm-menu__item no-underline"><ArrowUpRight size={14} />{children}</Link>
    </>
  );
}

/** Detailed list of the hosts to update: packages, security fixes, reboot; a reminder in one click. */
function UpdatesPanel({ hosts, onClose, onRemind, link }: { hosts: NotifHost[]; onClose: () => void; onRemind: (key: string) => void; link: [string, string] }) {
  const packages = hosts.reduce((n, h) => n + h.pending, 0);
  const security = hosts.reduce((n, h) => n + h.security, 0);
  const reboots = hosts.filter((h) => h.reboot).length;
  return (
    <>
      {hosts.length ? (
        <>
          <p className="px-2.5 pb-1.5 text-xs text-meta">
            {hosts.length} hôte(s) · {packages} paquet(s){security > 0 && <>, dont <span className="text-red">{security} de sécurité</span></>}
            {reboots > 0 && <> · {reboots} redémarrage(s)</>}
          </p>
          <ul className="max-h-[50vh] overflow-y-auto">
            {hosts.map((h) => (
              <li key={h.key} className="flex items-center gap-1">
                <Go to={h.href} onClick={onClose} className="mm-menu__item min-w-0 flex-1 no-underline">
                  <PackageCheck size={15} className="shrink-0 text-meta" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{h.name}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {h.pending > 0 && <Badge tone={h.security ? "red" : "blue"}>{h.pending}{h.security ? ` · ${h.security} sécu` : ""}</Badge>}
                    {h.reboot && <Badge tone="yellow">Redémarrage</Badge>}
                  </span>
                </Go>
                <Button variant="ghost" size="icon-sm" icon={<BellPlus size={14} />} title={`Rappel pour ${h.name}`} aria-label={`Programmer un rappel pour ${h.name}`} onClick={() => onRemind(h.key)} />
              </li>
            ))}
          </ul>
        </>
      ) : <Empty>Tous les hôtes sont à jour.</Empty>}
      <Footer to={link[0]} onClick={onClose}>{link[1]}</Footer>
    </>
  );
}

/** Custom reminders: "update this host on that day", once or on a period. */
function RemindersPanel({ rem, hosts, preset }: { rem: Reminders | null; hosts: NotifHost[]; preset: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const today = rem?.today ?? new Date().toLocaleDateString("sv-SE");
  const sorted = [...hosts].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  // A renamed host keeps its reminders: its current name comes from the feed by ref.
  const nameOf = (r: Reminder) => hosts.find((h) => h.key === r.host_ref)?.name ?? r.host;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refreshPolled(REMINDERS);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const ref = String(fd.get("host"));
    const ok = await run(() => api.post(REMINDERS, {
      host: hosts.find((h) => h.key === ref)?.name ?? ref, host_ref: hosts.some((h) => h.key === ref) ? ref : "", due_date: fd.get("due_date"), repeat_days: Number(fd.get("repeat_days")), note: fd.get("note"),
    }));
    if (ok) form.reset();
  };

  return (
    <div className="grid gap-2">
      {rem === null ? <Empty>Chargement…</Empty> : rem.reminders.length === 0 ? <Empty>Aucun rappel programmé.</Empty> : (
        <ul className="max-h-[40vh] overflow-y-auto">
          {rem.reminders.map((r) => {
            const host = nameOf(r);
            const late = r.due_date < today;
            return (
              <li key={r.id} className="flex items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-sm">
                <span className="mm-badge__dot shrink-0" style={{ background: TONE_VAR[late ? "red" : r.due ? "yellow" : "muted"] }} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-h1">{host}{r.note && <span className="text-meta"> · {r.note}</span>}</span>
                  <span className={cn("block text-xs", late ? "text-red" : r.due ? "text-yellow" : "text-meta")}>
                    {late ? `En retard depuis le ${fmtDay(r.due_date)}` : r.due ? "Aujourd'hui" : `Le ${fmtDay(r.due_date)}`}
                    {r.repeat_days > 0 && ` · tous les ${r.repeat_days} j`}
                  </span>
                </span>
                {r.due && (
                  <Button variant="ghost" size="icon-sm" icon={<Check size={14} />} disabled={busy}
                    title={r.repeat_days ? "Fait : prochain rappel dans la période" : "Fait : supprimer le rappel"} aria-label={`Marquer ${host} comme mis à jour`}
                    onClick={() => run(() => api.post(`/api/reminders/${r.id}/done`))} />
                )}
                <Button variant="danger-ghost" size="icon-sm" icon={<Trash2 size={14} />} disabled={busy} title="Supprimer le rappel" aria-label={`Supprimer le rappel de ${host}`}
                  onClick={() => run(() => api.del(`/api/reminders/${r.id}`))} />
              </li>
            );
          })}
        </ul>
      )}
      <div className="mm-menu__sep" role="separator" />
      <form onSubmit={add} className="grid gap-2 px-1.5 pb-1.5" key={preset}>
        <p className="mm-label-caps px-1">Nouveau rappel</p>
        {sorted.length ? (
          <select name="host" required defaultValue={preset} className={inputClass} aria-label="Hôte">
            <option value="" disabled>Hôte à mettre à jour…</option>
            {sorted.map((h) => <option key={h.key} value={h.key}>{h.name}</option>)}
          </select>
        ) : <input name="host" required maxLength={200} placeholder="Nom de l'hôte" className={inputClass} aria-label="Hôte" />}
        <div className="grid grid-cols-2 gap-2">
          <input name="due_date" type="date" required min={today} defaultValue={plusDays(today, 7)} className={inputClass} aria-label="Date du rappel" />
          <select name="repeat_days" defaultValue="0" className={inputClass} aria-label="Répétition">
            {REPEATS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
          </select>
        </div>
        <input name="note" maxLength={500} placeholder="Note (facultatif) : noyau, fenêtre de maintenance…" className={inputClass} aria-label="Note" />
        {error && <p role="alert" className="px-1 text-xs text-red">{error}</p>}
        <Button type="submit" size="sm" loading={busy} icon={<BellPlus size={14} />}>Ajouter le rappel</Button>
      </form>
    </div>
  );
}
