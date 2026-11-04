import Link from "next/link";
import { ChevronRight } from "../../../shared/icons";
import { PRIORITY_META, TONE_VAR } from "@/lib/constants";
import type { Task } from "@/lib/data/tasks";
import { cn, dateFormat } from "@/lib/utils";
import { TaskDialog, type TaskOptions } from "./task-dialog";
import { useT } from "@/i18n/client";

const WEEKDAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

/** "2026-11" ± n mois. */
export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Vue mois des tâches par échéance : grille sur grand écran, liste des jours sinon. */
export function TaskCalendar({ tasks, options, month, href }: { tasks: Task[]; options: TaskOptions; month: string; href: (month: string) => string }) {
  const tr = useT();
  const [y, m] = month.split("-").map(Number);
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = new Date().toLocaleDateString("sv"); // YYYY-MM-DD, heure locale
  const byDay = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.due_date?.startsWith(month)) byDay.set(t.due_date, [...(byDay.get(t.due_date) ?? []), t]);
  }
  for (const l of byDay.values()) l.sort((a, b) => (a.due_time ?? "").localeCompare(b.due_time ?? ""));
  const undated = tasks.filter((t) => !t.due_date && t.status !== "done").length;
  const dates = Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const cells = [...Array<null>(offset).fill(null), ...dates];
  while (cells.length % 7) cells.push(null);

  const items = (date: string) => (
    <ul className="grid gap-1">
      {(byDay.get(date) ?? []).map((t) => (
        <li key={t.id} className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TONE_VAR[PRIORITY_META[t.priority].tone] }} aria-hidden="true" />
          <span
            title={t.title}
            className={cn("min-w-0 flex-1 truncate", t.status === "done" ? "text-meta line-through" : date < today ? "text-red" : "text-h1")}
          >
            {t.due_time && <span className="font-mono text-meta">{t.due_time} </span>}
            {t.title}
          </span>
          <TaskDialog task={t} options={options} />
        </li>
      ))}
    </ul>
  );
  const add = (date: string) => <TaskDialog options={options} defaultDue={date} variant="icon" label={tr("Ajouter le {date}", { date })} />;

  return (
    <section aria-label={tr("Calendrier des tâches")} className="grid gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-h2">
          {dateFormat(tr.locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)))}
        </h2>
        <nav aria-label={tr("Mois")} className="ml-auto flex items-center gap-1 font-mono text-xs">
          <Link href={href(shiftMonth(month, -1))} scroll={false} className="rounded-full p-2 text-body hover:text-h1" aria-label={tr("Mois précédent")}>
            <ChevronRight size={14} className="rotate-180" aria-hidden="true" />
          </Link>
          <Link href={href(today.slice(0, 7))} scroll={false} className="rounded-full px-3 py-1.5 text-body hover:text-h1">
            {tr("Aujourd'hui")}
          </Link>
          <Link href={href(shiftMonth(month, 1))} scroll={false} className="rounded-full p-2 text-body hover:text-h1" aria-label={tr("Mois suivant")}>
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        </nav>
      </header>

      <div className="hidden grid-cols-7 gap-2 lg:grid">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 font-mono text-xs uppercase tracking-[0.18em] text-meta">
            {d}
          </div>
        ))}
        {cells.map((date, i) =>
          date ? (
            <div
              key={date}
              className={cn("group flex min-h-28 min-w-0 flex-col gap-1 rounded-2xl border bg-box p-2", date === today ? "border-accent" : "border-line-subtle")}
            >
              <div className="flex items-center justify-between">
                <span className={cn("px-1 tabular-nums text-xs", date === today ? "text-accent-text" : "text-meta")}>{Number(date.slice(8))}</span>
                <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">{add(date)}</span>
              </div>
              {items(date)}
            </div>
          ) : (
            <div key={`empty-${i}`} aria-hidden="true" />
          ),
        )}
      </div>

      <ol className="grid gap-2 lg:hidden">
        {dates
          .filter((d) => byDay.has(d))
          .map((date) => (
            <li key={date} className={cn("rounded-2xl border bg-box p-3", date === today ? "border-accent" : "border-line-subtle")}>
              <div className="mb-2 flex items-center justify-between">
                <span className="tabular-nums text-xs text-meta">
                  {dateFormat(tr.locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))}
                </span>
                {add(date)}
              </div>
              {items(date)}
            </li>
          ))}
        {byDay.size === 0 && <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-meta">{tr("Aucune échéance ce mois-ci.")}</p>}
      </ol>

      {undated > 0 && <p className="text-xs text-meta">{tr("{n} tâche(s) sans échéance, visibles dans le tableau.", { n: undated })}</p>}
    </section>
  );
}
