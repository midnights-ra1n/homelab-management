import { Suspense, use } from "react";
import { listTasks, taskCounts, taskTags } from "@/lib/data/tasks";
import { assetOptions } from "@/lib/data/assets";
import { deploymentOptions } from "@/lib/data/deployments";
import { clearDoneTasksAction } from "@/actions/tasks";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterBar } from "@/components/filter-bar";
import { TaskBoard } from "@/features/tasks/task-board";
import { TaskDialog } from "@/features/tasks/task-dialog";
import { TaskSync } from "@/features/tasks/task-sync";
import { TaskCalendar } from "@/features/tasks/task-calendar";
import { TaskSyncGuide } from "@/features/tasks/task-sync-guide";
import { ViewSwitch } from "@/components/view-switch";
import { resolveView } from "@/lib/view-pref";
import { listIntegrations } from "@/lib/data/integrations";
import { Archive, CalendarDays, Columns2 } from "../../../shared/icons";
import { getT } from "@/i18n/server";

export default function TasksPage({ searchParams }: PageProps<"/[lang]/taches">) {
  const tr = use(getT());
  return (
    <>
      <PageHeader
        title={tr("Ce qu'il reste à faire")}
        description={tr("Un tableau Kanban pour la maintenance, les idées et les corrections. Glisse les cartes d'une colonne à l'autre.")}
      />
      <Suspense fallback={<Skeleton className="h-[28rem] rounded-3xl" />}>
        <Board searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function Board({ searchParams }: { searchParams: PageProps<"/[lang]/taches">["searchParams"] }) {
  const tr = use(getT());
  const sp = use(searchParams);
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const tag = typeof sp.tag === "string" ? sp.tag : undefined;
  const mode = use(resolveView("taches", ["tableau", "calendrier"] as const, "tableau", sp.mode));
  const month = typeof sp.mois === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mois) ? sp.mois : new Date().toLocaleDateString("sv").slice(0, 7);
  const href = (m: string, mo = month) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (tag) p.set("tag", tag);
    p.set("mode", m);
    if (m === "calendrier") p.set("mois", mo);
    return `/taches?${p}`;
  };
  const tasks = use(listTasks({ q, tag }));
  const counts = use(taskCounts());
  const lists = use(listIntegrations("nextcloud"));
  const synced = lists.some((l) => l.enabled);
  const options = {
    assets: use(assetOptions()).map((a) => ({ id: a.id, display_name: a.display_name })),
    deployments: use(deploymentOptions()),
    lists: lists.map((l) => ({ id: l.id, name: l.enabled ? l.name : tr("{name} (désactivée)", { name: l.name }) })),
  };
  return (
    <div className="grid grid-cols-1 gap-8 xl:gap-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <FilterBar
          className="flex-1"
          placeholder={tr("Rechercher une tâche…")}
          selects={[{ name: "tag", label: tr("Tous les tags"), options: use(taskTags()).map((t) => ({ value: t, label: t })) }]}
        />
        <div className="flex flex-wrap items-center gap-3">
          <ViewSwitch
            name="taches"
            value={mode}
            options={[
              { value: "tableau", label: tr("Tableau"), icon: <Columns2 size={13} aria-hidden />, href: href("tableau") },
              { value: "calendrier", label: tr("Calendrier"), icon: <CalendarDays size={13} aria-hidden />, href: href("calendrier") },
            ]}
          />
          {counts.overdue > 0 && <span className="font-mono text-xs text-red">{counts.overdue} {tr("en retard")}</span>}
          {counts.done > 0 && (
            <ConfirmButton
              action={clearDoneTasksAction}
              title={tr("Archiver les tâches terminées")}
              message={tr("Supprimer définitivement les {done} tâche(s) terminée(s) ?", { done: counts.done })}
              confirmLabel={tr("Archiver")}
              variant="secondary"
              size="md"
              icon={<Archive size={15} />}
            >
              {tr("Archiver terminées")}</ConfirmButton>
          )}
          {synced && <TaskSync />}
          <TaskDialog options={options} />
        </div>
      </div>
      {mode === "calendrier" ? (
        <TaskCalendar tasks={tasks} options={options} month={month} href={(mo) => href("calendrier", mo)} />
      ) : (
        <TaskBoard tasks={tasks} options={options} />
      )}
      <TaskSyncGuide open={!synced} />
    </div>
  );
}
