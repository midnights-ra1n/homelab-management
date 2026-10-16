// Types of homelab-management's lib/data/map.ts + client fetchers.
import { get } from "../client";
import { resource } from "../resource";
import type { LinkKind } from "../constants";

export type MapLink = { id: number; source_id: number; target_id: number; kind: LinkKind; label: string };


const mapData = () => get<{ positions: Record<number, { x: number; y: number }>; links: MapLink[] }>("/api/mg/map");
export const mapPositions = () => resource("map:positions", () => mapData().then((m) => m.positions));
export const listLinks = () => resource("map:links", () => mapData().then((m) => m.links));
