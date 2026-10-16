import { api, write } from "../lib/client";
import type { LinkKind } from "../lib/constants";

/** Positions are saved without refreshing the page (the map already shows them). */
export const savePositionsAction = async (positions: { id: number; x: number; y: number }[]): Promise<void> => void await
  api.put("/api/mg/map/positions", positions.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isInteger(p.id)));
export const resetPositionsAction = () => write("DELETE", "/api/mg/map/positions");
export const createLinkAction = (source: number, target: number, kind: LinkKind, label: string) =>
  write("POST", "/api/mg/map/links", { source, target, kind, label: label.slice(0, 60) });
export const deleteLinkAction = (id: number) => write("DELETE", `/api/mg/map/links/${id}`);
