import "server-only";
import type { Translate } from "@/i18n/translate";
import { monitoringSummary } from "../integrations";
import { formatDate } from "../utils";

export type MonitorAlert = { tone: "red" | "yellow"; text: string; href: string };

/** Alertes en cours (Homelab Monitoring / Beszel / Maintenant / PatchMon), pannes en premier. */
export async function collectAlerts(tr: Translate) {
  const m = await monitoringSummary();
  const alerts: MonitorAlert[] = [
    ...m.systems.down.map((s) => ({ tone: "red" as const, text: tr("{name} hors ligne ({source})", { name: s.name, source: s.source }), href: "/monitoring" })),
    ...m.systems.hot.map((s) => ({
      tone: "yellow" as const,
      text: tr("{name} : CPU {cpu} % · RAM {mem} % · disque {disk} %", { name: s.name, cpu: Math.round(s.cpu ?? 0), mem: Math.round(s.mem ?? 0), disk: Math.round(s.disk ?? 0) }),
      href: "/monitoring",
    })),
    ...m.containers.unhealthy.map((c) => ({ tone: "red" as const, text: tr("Conteneur {name} : {1}", { name: c.name, "1": c.health ?? c.state }), href: "/monitoring" })),
    ...m.endpoints.down.map((e) => ({ tone: "red" as const, text: tr("Endpoint {name} : {status}", { name: e.name, status: e.status }), href: "/monitoring" })),
    ...m.certificates.expiring.map((c) => ({
      tone: "yellow" as const,
      text: tr("Certificat {name} expire le {1}", { name: c.name, "1": formatDate(c.expiresAt, tr.locale) }),
      href: "/monitoring",
    })),
    ...m.probes.down.map((x) => ({ tone: "red" as const, text: tr("Sonde {name} : {message}", { name: x.name, message: x.message }), href: "/monitoring" })),
    ...m.patches.reboot.map((name) => ({ tone: "yellow" as const, text: tr("{friendlyName} doit redémarrer", { friendlyName: name }), href: "/monitoring" })),
    ...m.errors.map((e) => ({ tone: "red" as const, text: `${e.name} : ${tr(e.error)}`, href: "/parametres#integrations" })),
  ];
  alerts.sort((x, y) => (x.tone === y.tone ? 0 : x.tone === "red" ? -1 : 1));
  return { m, alerts };
}
