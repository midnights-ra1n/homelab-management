"use client";

import Link from "next/link";
import { CalendarDays, Rocket, Server } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { deleteTaskAction, moveTaskAction } from "@/actions/tasks";
import { Badge, Tag } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { PRIORITY_META, TASK_STATUSES, TASK_STATUS_META, TONE_VAR, type TaskStatus } from "@/lib/constants";
import type { Task } from "@/lib/data/tasks";
import { cn, formatDate, isOverdue } from "@/lib/utils";
import { TaskDialog, type TaskOptions } from "./task-dialog";
import { useT } from "@/i18n/client";

type Move = { id: number; status: TaskStatus; beforeId: number | null };

/** Tableau Kanban : glisser-déposer entre colonnes (souris) + menu de déplacement (clavier). */
export function TaskBoard({ tasks, options }: { tasks: Task[]; options: TaskOptions }) {
  const tr = useT();
  const [optimistic, applyMove] = useOptimistic(tasks, (state, m: Move) => {
    const task = state.find((t) => t.id === m.id);
    if (!task) return state;
    const rest = state.filter((t) => t.id !== m.id);
    const moved = { ...task, status: m.status };
    const index = m.beforeId ? rest.findIndex((t) => t.id === m.beforeId) : -1;
    if (index === -1) return [...rest, moved];
    return [...rest.slice(0, index), moved, ...rest.slice(index)];
  });
  const [, start] = useTransition();
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<{ status: TaskStatus; beforeId: number | null } | null>(null);

  const move = (m: Move) =>
    start(async () => {
      applyMove(m);
      await moveTaskAction(m.id, m.status, m.beforeId);
    });

  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:-mx-5 sm:px-5 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0">
      {TASK_STATUSES.map((status) => {
        const column = optimistic.filter((t) => t.status === status);
        const meta = TASK_STATUS_META[status];
        const isOver = over?.status === status;
        return (
          <section
            key={status}
            aria-label={tr(meta.label)}
            onDragOver={(e) => {
              if (dragId === null) return;
              e.preventDefault();
              if (!isOver || over?.beforeId !== null) {
                const target = (e.target as HTMLElement).closest<HTMLElement>("[data-task-id]");
                setOver({ status, beforeId: target ? Number(target.dataset.taskId) : null });
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId !== null && over) move({ id: dragId, status, beforeId: over.beforeId === dragId ? null : over.beforeId });
              setDragId(null);
              setOver(null);
            }}
            className={cn(
              "flex min-h-[20rem] w-[85vw] max-w-sm shrink-0 snap-center flex-col rounded-3xl border p-3 transition-colors duration-200 lg:w-auto lg:max-w-none",
              isOver ? "border-accent bg-accent-soft" : "border-line-subtle bg-crust/60",
            )}
          >
            <header className="mb-3 flex items-center justify-between px-2 pt-1">
              <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-h2">
                <span className="h-2 w-2 rounded-full" style={{ background: TONE_VAR[meta.tone] }} aria-hidden="true" />
                {tr(meta.label)}
                <span className="text-meta">{column.length}</span>
              </h2>
              <TaskDialog options={options} defaultStatus={status} variant="icon" label={tr("Ajouter dans « {label} »", { label: tr(meta.label) })} />
            </header>
            <ol className="grid content-start gap-2">
              {column.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  options={options}
                  dragging={dragId === t.id}
                  dropBefore={isOver && over?.beforeId === t.id && dragId !== t.id}
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOver(null);
                  }}
                  onMove={(s) => move({ id: t.id, status: s, beforeId: null })}
                />
              ))}
            </ol>
            {column.length === 0 && (
              <p className="m-2 flex flex-1 items-center justify-center rounded-2xl border border-dashed border-line p-6 text-center text-sm text-meta">
                {tr("Dépose une tâche ici")}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function TaskCard({
  task,
  options,
  dragging,
  dropBefore,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  task: Task;
  options: TaskOptions;
  dragging: boolean;
  dropBefore: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (s: TaskStatus) => void;
}) {
  const tr = useT();
  const late = task.status !== "done" && isOverdue(task.due_date);
  const priority = PRIORITY_META[task.priority];
  return (
    <li
      data-task-id={task.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(task.id));
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative cursor-grab rounded-2xl border border-line-subtle bg-box p-4 transition-[opacity,border-color] active:cursor-grabbing",
        dragging && "opacity-40",
        dropBefore && "before:absolute before:-top-1.5 before:left-3 before:right-3 before:h-0.5 before:rounded-full before:bg-accent",
        "hover:border-line",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_VAR[priority.tone] }} title={tr("Priorité {label}", { label: tr(priority.label) })} />
        <p className={cn("flex-1 text-sm font-medium", task.status === "done" ? "text-meta line-through" : "text-h1")}>{task.title}</p>
        <div className="-mr-2 -mt-2 flex opacity-100 transition-opacity lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
          <TaskDialog task={task} options={options} />
          <ConfirmButton action={() => deleteTaskAction(task.id)} message={tr("Supprimer la tâche « {title} » ?", { title: task.title })} />
        </div>
      </div>
      {task.description && <p className="ml-5 mt-1 line-clamp-3 whitespace-pre-line text-xs text-body">{task.description}</p>}
      <div className="ml-5 mt-3 flex flex-wrap items-center gap-2 text-xs text-meta">
        {task.priority === "critical" || task.priority === "high" ? <Badge tone={priority.tone}>{tr(priority.label)}</Badge> : null}
        {task.due_date && (
          <span className={cn("flex items-center gap-1 font-mono", late && "text-red")}>
            <CalendarDays size={12} aria-hidden="true" />
            {formatDate(task.due_date, tr.locale)}
          </span>
        )}
        {task.asset_id && (
          <Link href={`/inventaire/${task.asset_id}`} className="flex items-center gap-1 hover:text-accent-text">
            <Server size={12} aria-hidden="true" /> {task.asset_name}
          </Link>
        )}
        {task.deployment_id && (
          <Link href={`/deploiements/${task.deployment_id}`} className="flex items-center gap-1 hover:text-accent-text">
            <Rocket size={12} aria-hidden="true" /> {task.deployment_title}
          </Link>
        )}
        {task.tags.map((t) => (
          <Tag key={t}>{t}</Tag>
        ))}
      </div>
      {/* Déplacement accessible au clavier */}
      <label className="sr-only" htmlFor={`move-${task.id}`}>
        {tr("Déplacer vers")}</label>
      <select
        id={`move-${task.id}`}
        value={task.status}
        onChange={(e) => onMove(e.target.value as TaskStatus)}
        className="field mt-3 block w-full rounded-full px-3 py-2 text-sm lg:sr-only lg:focus:not-sr-only lg:focus:mt-3 lg:focus:block lg:focus:w-full lg:focus:text-xs"
      >
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            → {tr(TASK_STATUS_META[s].label)}
          </option>
        ))}
      </select>
    </li>
  );
}
