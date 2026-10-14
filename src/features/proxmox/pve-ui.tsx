import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { LinkTabs } from "@/components/ui/tabs";
import type { PveRrdPoint, PveTask, Timeframe } from "@/lib/integrations/proxmox";
import type { Translate } from "@/i18n/translate";
import { cn, dateFormat } from "@/lib/utils";
import { RrdChart, type RrdFormat } from "./rrd-chart";

/** Briques serveur des pages détaillées Proxmox (nœud, invité). */

/** Lit l'API sans faire tomber la page : l'onglet affiche l'erreur à la place. */
export async function attempt<T>(p: Promise<T>): Promise<{ ok: true; data: T; error?: undefined } | { ok: false; data?: undefined; error: string }> {
  try {
    return { ok: true, data: await p };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function ApiError({ error }: { error: string }) {
  return <Alert kind="error">{error}</Alert>;
}

/** Tableau de la charte : en-tête discret, lignes séparées, défilement horizontal sur mobile. */
export function PveTable({ head, rows, empty, align = [] }: { head: string[]; rows: ReactNode[][]; empty: string; align?: ("right" | undefined)[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line-subtle bg-box mint:rounded-2xl">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line-subtle bg-crust/40 text-xs text-meta">
              {head.map((h, idx) => (
                <th key={idx} className={cn("whitespace-nowrap px-4 py-2.5 font-medium", align[idx] === "right" && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx} className="border-b border-line-subtle last:border-0 hover:bg-elevated/50">
                {r.map((c, j) => (
                  <td key={j} className={cn("px-4 py-2.5 align-middle text-h2", align[j] === "right" && "text-right tabular-nums")}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={head.length} className="px-4 py-10 text-center text-sm text-meta">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Liste clé / valeur (onglet Résumé). */
export function InfoList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-8 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 border-b border-line-subtle py-2.5">
          <dt className="shrink-0 text-sm text-meta">{k}</dt>
          <dd className="min-w-0 truncate text-right text-sm text-h2">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TaskTable({ tasks, tr }: { tasks: PveTask[]; tr: Translate }) {
  const fmt = dateFormat(tr.locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <PveTable
      head={[tr("Début"), tr("Fin"), tr("Type"), tr("Objet"), tr("Utilisateur"), tr("État")]}
      empty={tr("Aucune tâche récente.")}
      rows={tasks.map((t) => {
        const running = !t.endtime;
        const ok = t.status === "OK";
        return [
          <span key="s" className="whitespace-nowrap font-mono text-xs">{fmt.format(new Date(t.starttime * 1000))}</span>,
          <span key="e" className="whitespace-nowrap font-mono text-xs">{t.endtime ? fmt.format(new Date(t.endtime * 1000)) : "—"}</span>,
          <span key="t" className="font-mono text-xs">{t.type}</span>,
          <span key="i" className="font-mono text-xs">{t.id || "—"}</span>,
          <span key="u" className="font-mono text-xs text-body">{t.user}</span>,
          <span key="st" className="flex items-center gap-2">
            <Badge tone={running ? "blue" : ok ? "green" : "red"}>{running ? tr("En cours") : ok ? "OK" : tr("Erreur")}</Badge>
            {!ok && !running && t.status && <span className="max-w-64 truncate text-xs text-red" title={t.status}>{t.status}</span>}
          </span>,
        ];
      })}
    />
  );
}

const TF_LABELS: Record<Timeframe, string> = { hour: "Heure", day: "Jour", week: "Semaine", month: "Mois", year: "Année" };

/** Sélecteur de période des graphiques RRD (paramètre ?tf=). */
export function TimeframeTabs({ base, active, tr }: { base: string; active: Timeframe; tr: Translate }) {
  return (
    <LinkTabs
      label={tr("Période")}
      active={active}
      items={(Object.keys(TF_LABELS) as Timeframe[]).map((tf) => ({ value: tf, label: tr(TF_LABELS[tf]), href: `${base}&tf=${tf}` }))}
    />
  );
}

/** Grille de graphiques RRD : une série par graphique (pas de légende, le titre la nomme). */
export function RrdGrid({ points, series }: { points: PveRrdPoint[]; series: { title: string; key: keyof PveRrdPoint; format: RrdFormat; max?: number | ((p: PveRrdPoint[]) => number | undefined) }[] }) {
  const times = points.map((p) => p.time);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {series.map((s) => (
        <RrdChart
          key={s.title}
          title={s.title}
          times={times}
          values={points.map((p) => (typeof p[s.key] === "number" ? (p[s.key] as number) : null))}
          format={s.format}
          max={typeof s.max === "function" ? s.max(points) : s.max}
        />
      ))}
    </div>
  );
}
