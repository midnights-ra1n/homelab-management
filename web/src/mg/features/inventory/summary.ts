import type { Asset } from "@/lib/data/assets";
import { formatGb } from "@/lib/utils";
import type { Translate } from "@/i18n/translate";

/** « 4 vCPU · 8 Go · 64 Go » — partagé serveur / client. */
export function resourceSummary(a: Pick<Asset, "kind" | "cpu_cores" | "ram_gb" | "disks">, tr: Translate) {
  const parts: string[] = [];
  if (a.cpu_cores) parts.push(`${a.cpu_cores} ${a.kind === "vm" || a.kind === "lxc" ? "vCPU" : tr("cœurs")}`);
  if (a.ram_gb) parts.push(`${+a.ram_gb} ${tr.locale === "en" ? "GB" : "Go"}`);
  const disk = a.disks.reduce((n, d) => n + (d.capacity_gb ?? 0), 0);
  if (disk) parts.push(formatGb(disk, tr.locale));
  return parts.join(" · ");
}

/** Poids de tri des ressources : mémoire d'abord, puis CPU. */
export const resourceWeight = (a: Pick<Asset, "cpu_cores" | "ram_gb">) => (a.ram_gb ?? 0) * 1000 + (a.cpu_cores ?? 0);
