import "server-only";
import { all, run } from "../db";

export type Activity = {
  id: number;
  entity_type: string;
  entity_id: number | null;
  action: "create" | "update" | "delete" | string;
  summary: string;
  created_at: string;
};

export function logActivity(entity_type: string, entity_id: number | null, action: string, summary: string) {
  run("INSERT INTO activity (entity_type, entity_id, action, summary) VALUES (?, ?, ?, ?)", [
    entity_type,
    entity_id,
    action,
    summary,
  ]);
  // Garde le journal à une taille raisonnable
  run("DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT 1000)");
}

export function recentActivity(limit = 15): Activity[] {
  return all<Activity>("SELECT * FROM activity ORDER BY id DESC LIMIT ?", [limit]);
}

/** Historique d'un élément (le plus récent d'abord). */
export function activityFor(entity_type: string, entity_id: number, limit = 30): Activity[] {
  return all<Activity>("SELECT * FROM activity WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT ?", [
    entity_type,
    entity_id,
    limit,
  ]);
}
