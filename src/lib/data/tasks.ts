import "server-only";
import { all, get, run } from "../db";
import type { Priority, TaskStatus } from "../constants";
import { parseJson } from "../utils";
import type { TaskInput } from "../validation";
import { logActivity } from "./activity";

export type Task = {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  tags: string[];
  asset_id: number | null;
  asset_name: string | null;
  deployment_id: number | null;
  deployment_title: string | null;
  position: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT = `
  SELECT t.*, a.display_name AS asset_name, d.title AS deployment_title
  FROM tasks t
  LEFT JOIN assets a ON a.id = t.asset_id
  LEFT JOIN deployments d ON d.id = t.deployment_id`;

const ORDER = `ORDER BY t.position,
  CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
  COALESCE(t.due_date, '9999'), t.id DESC`;

function hydrate(row: Omit<Task, "tags"> & { tags: string }): Task {
  return { ...row, tags: parseJson<string[]>(row.tags, []) };
}

export function listTasks(filters: { q?: string; tag?: string; asset?: number; deployment?: number } = {}): Task[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filters.q) {
    where.push("(t.title LIKE ? OR t.description LIKE ?)");
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }
  if (filters.tag) {
    where.push("EXISTS (SELECT 1 FROM json_each(t.tags) WHERE value = ?)");
    params.push(filters.tag);
  }
  if (filters.asset) {
    where.push("t.asset_id = ?");
    params.push(filters.asset);
  }
  if (filters.deployment) {
    where.push("t.deployment_id = ?");
    params.push(filters.deployment);
  }
  return all<Omit<Task, "tags"> & { tags: string }>(
    `${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ${ORDER}`,
    params,
  ).map(hydrate);
}

export function openTasks(limit = 8): Task[] {
  return all<Omit<Task, "tags"> & { tags: string }>(
    `${SELECT} WHERE t.status != 'done' ORDER BY
      CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date,
      CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
     LIMIT ?`,
    [limit],
  ).map(hydrate);
}

export function taskCounts() {
  const today = new Date().toISOString().slice(0, 10);
  return get<{ todo: number; in_progress: number; done: number; overdue: number }>(
    `SELECT
      COALESCE(SUM(status = 'todo'), 0) AS todo,
      COALESCE(SUM(status = 'in_progress'), 0) AS in_progress,
      COALESCE(SUM(status = 'done'), 0) AS done,
      COALESCE(SUM(status != 'done' AND due_date IS NOT NULL AND due_date < ?), 0) AS overdue
     FROM tasks`,
    [today],
  )!;
}

export function taskTags(): string[] {
  return all<{ tag: string }>(
    "SELECT DISTINCT value AS tag FROM tasks, json_each(tasks.tags) ORDER BY value",
  ).map((r) => r.tag);
}

export function createTask(input: TaskInput) {
  const { lastId } = run(
    `INSERT INTO tasks (title, description, status, priority, due_date, tags, asset_id, deployment_id, completed_at, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'done' THEN datetime('now') END,
       (SELECT COALESCE(MIN(position), 0) - 1 FROM tasks WHERE status = ?))`,
    [
      input.title,
      input.description,
      input.status,
      input.priority,
      input.due_date,
      JSON.stringify(input.tags),
      input.asset_id,
      input.deployment_id,
      input.status,
      input.status,
    ],
  );
  logActivity("task", lastId, "create", `Nouvelle tâche « ${input.title} »`);
}

export function updateTask(id: number, input: TaskInput) {
  run(
    `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, due_date = ?, tags = ?, asset_id = ?,
       deployment_id = ?, completed_at = CASE WHEN ? = 'done' THEN COALESCE(completed_at, datetime('now')) ELSE NULL END,
       updated_at = datetime('now') WHERE id = ?`,
    [
      input.title,
      input.description,
      input.status,
      input.priority,
      input.due_date,
      JSON.stringify(input.tags),
      input.asset_id,
      input.deployment_id,
      input.status,
      id,
    ],
  );
  logActivity("task", id, "update", `Modification de la tâche « ${input.title} »`);
}

/** Déplace une tâche (glisser-déposer) : nouvelle colonne et position avant `beforeId`. */
export function moveTask(id: number, status: TaskStatus, beforeId: number | null) {
  const ids = all<{ id: number }>("SELECT id FROM tasks WHERE status = ? AND id != ? ORDER BY position, id", [status, id]).map(
    (r) => r.id,
  );
  const index = beforeId ? ids.indexOf(beforeId) : -1;
  ids.splice(index === -1 ? ids.length : index, 0, id);
  ids.forEach((tid, i) => run("UPDATE tasks SET position = ? WHERE id = ?", [i, tid]));
  const before = get<{ status: string; title: string }>("SELECT status, title FROM tasks WHERE id = ?", [id]);
  run(
    `UPDATE tasks SET status = ?, updated_at = datetime('now'),
       completed_at = CASE WHEN ? = 'done' THEN COALESCE(completed_at, datetime('now')) ELSE NULL END WHERE id = ?`,
    [status, status, id],
  );
  if (before && before.status !== status && status === "done") {
    logActivity("task", id, "update", `Tâche terminée : « ${before.title} »`);
  }
}

export function deleteTask(id: number) {
  const t = get<{ title: string }>("SELECT title FROM tasks WHERE id = ?", [id]);
  run("DELETE FROM tasks WHERE id = ?", [id]);
  if (t) logActivity("task", id, "delete", `Suppression de la tâche « ${t.title} »`);
}

export function clearDoneTasks() {
  const { changes } = run("DELETE FROM tasks WHERE status = 'done'");
  if (changes) logActivity("task", null, "delete", `${changes} tâche(s) terminée(s) archivée(s)`);
}
