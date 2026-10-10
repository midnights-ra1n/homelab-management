import "server-only";
import { all, run } from "../db";
import type { LinkKind } from "../constants";

export type MapLink = { id: number; source_id: number; target_id: number; kind: LinkKind; label: string };

export function mapPositions(): Record<number, { x: number; y: number }> {
  const out: Record<number, { x: number; y: number }> = {};
  for (const p of all<{ asset_id: number; x: number; y: number }>("SELECT * FROM map_positions")) {
    out[p.asset_id] = { x: p.x, y: p.y };
  }
  return out;
}

export function savePositions(positions: { id: number; x: number; y: number }[]) {
  for (const p of positions) {
    run(
      `INSERT INTO map_positions (asset_id, x, y) VALUES (?, ?, ?)
       ON CONFLICT(asset_id) DO UPDATE SET x = excluded.x, y = excluded.y`,
      [p.id, Math.round(p.x), Math.round(p.y)],
    );
  }
}

export function resetPositions() {
  run("DELETE FROM map_positions");
}

export function listLinks(): MapLink[] {
  return all<MapLink>("SELECT id, source_id, target_id, kind, label FROM map_links");
}

export function createLink(source: number, target: number, kind: LinkKind, label: string) {
  if (source === target) return;
  run(
    `INSERT INTO map_links (source_id, target_id, kind, label) VALUES (?, ?, ?, ?)
     ON CONFLICT(source_id, target_id) DO UPDATE SET kind = excluded.kind, label = excluded.label`,
    [source, target, kind, label],
  );
}

export function deleteLink(id: number) {
  run("DELETE FROM map_links WHERE id = ?", [id]);
}
