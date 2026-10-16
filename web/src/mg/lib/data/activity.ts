// Types of homelab-management's lib/data/activity.ts + client fetchers.
import { get, qs } from "../client";
import { resource } from "../resource";

export type Activity = {
  id: number;
  entity_type: string;
  entity_id: number | null;
  action: "create" | "update" | "delete" | string;
  summary: string;
  created_at: string;
};


type Logs = { items: (Activity & { actor: string })[] };
export const recentActivity = (limit = 15) => resource(`activity:${limit}`, () => get<Logs>(`/api/logs${qs({ limit })}`).then((l) => l.items));
export const activityFor = (entity: string, id: number, limit = 30) =>
  resource(`activity:${entity}:${id}:${limit}`, () => get<Logs>(`/api/logs${qs({ entity, entity_id: id, limit })}`).then((l) => l.items));
