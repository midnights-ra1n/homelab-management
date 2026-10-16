// Types of homelab-management's lib/data/tasks.ts + client fetchers.
import { get, qs } from "../client";
import { resource } from "../resource";
import { workData } from "./deployments";
import type { Priority, TaskStatus } from "../constants";

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


/* ---------------------------------------------------------------- fetchers */

export const listTasks = (filters: { q?: string; tag?: string; asset?: number; deployment?: number } = {}) =>
  get<Task[]>(`/api/mg/tasks${qs(filters)}`);
export const openTasks = (limit = 8) => resource(`work:open:${limit}`, () => workData().then((w) => w.open_tasks.slice(0, limit)));
export const taskCounts = () => resource("work:task-counts", () => workData().then((w) => w.task_counts[0]));
export const taskTags = () => resource("work:task-tags", () => workData().then((w) => w.task_tags.map((r) => r.tag)));
