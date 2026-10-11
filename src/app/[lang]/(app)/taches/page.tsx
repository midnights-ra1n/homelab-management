import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
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
import { Archive } from "lucide-react";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Tâches") };
}

export default async function TasksPage({ searchParams }: PageProps<"/[lang]/taches">) {
  const tr = await getT();
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

async function Board({ searchParams }: { searchParams: PageProps<"/[lang]/taches">["searchParams"] }) {
  const tr = await getT();
  await requireUser();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const tag = typeof sp.tag === "string" ? sp.tag : undefined;
  const tasks = listTasks({ q, tag });
  const counts = taskCounts();
  const options = {
    assets: assetOptions().map((a) => ({ id: a.id, display_name: a.display_name })),
    deployments: deploymentOptions(),
  };
  return (
    <div className="grid grid-cols-1 gap-6 xl:gap-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <FilterBar
          className="flex-1"
          placeholder={tr("Rechercher une tâche…")}
          selects={[{ name: "tag", label: tr("Tous les tags"), options: taskTags().map((t) => ({ value: t, label: t })) }]}
        />
        <div className="flex items-center gap-3">
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
          <TaskDialog options={options} />
        </div>
      </div>
      <TaskBoard tasks={tasks} options={options} />
    </div>
  );
}
