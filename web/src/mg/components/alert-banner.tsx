
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { ArrowUpRight } from "../../shared/icons";
import { NotificationsMenu, type NotifFeed } from "../../shared/notifications";
import { usePolled } from "../../shared/poll";
import type { MonitorAlert } from "@/lib/monitor/alerts";
import { useT } from "@/i18n/client";
import { ButtonLink } from "@/components/ui/button";
import { Alert } from "../../ui";
import { alertsFrom } from "@/lib/monitor/alerts";
import type { Source } from "@/lib/integrations";
import type { HlmData } from "@/lib/integrations/hlm";
import { tr } from "@/i18n/translate";

const MONITORING = "/api/mg/monitoring";

/** Alertes du monitoring, relues toutes les 30 s par le même appel que le menu Notifications. */
function useAlerts(initial: MonitorAlert[] | null, refreshOnChange = false) {
  const router = useRouter();
  const sources = usePolled<Source<HlmData>[]>(MONITORING);
  const alerts = useMemo(() => (sources ? alertsFrom(sources, tr) : initial), [sources, initial]);
  const last = useRef(JSON.stringify(initial));
  useEffect(() => {
    const key = JSON.stringify(alerts);
    if (key === last.current) return;
    const first = last.current === "null";
    last.current = key;
    if (!first && refreshOnChange) router.refresh();
  }, [alerts, refreshOnChange, router]);
  return alerts ?? [];
}

function summary(alerts: MonitorAlert[], tr: ReturnType<typeof useT>) {
  const critical = alerts.filter((a) => a.tone === "red").length;
  return {
    critical,
    title: critical ? tr("{n} incident(s) en cours", { n: critical }) : tr("{n} point(s) d'attention", { n: alerts.length }),
  };
}

/** Bannière du tableau de bord : grande, liste les alertes. */
export function AlertBanner({ initial }: { initial: MonitorAlert[] }) {
  const tr = useT();
  // Une alerte change : on rafraîchit aussi le widget Monitoring rendu côté serveur.
  const alerts = useAlerts(initial, true);
  if (!alerts.length) return null;
  const { critical, title } = summary(alerts, tr);
  return (
    <Alert kind={critical ? "error" : "warning"} title={title}
      action={<ButtonLink href="/monitoring" variant="secondary" size="sm" icon={<ArrowUpRight size={14} />}>{tr("Voir le monitoring")}</ButtonLink>}>
      {critical > 0 && alerts.length > critical ? tr("+ {n} avertissement(s)", { n: alerts.length - critical }) : undefined}
    </Alert>
  );
}

/** Flux de notifications de la gestion : alertes et état des mises à jour des hôtes du monitoring. */
const toFeed = (sources: Source<HlmData>[]): NotifFeed => ({
    alerts: alertsFrom(sources, tr).map((a, i) => ({ key: `a${i}`, critical: a.tone === "red", text: a.text, href: a.href })),
    hosts: sources.flatMap((s) => (s.data?.hosts ?? []).map((h) => ({
      key: `${s.id}:${h.id}`, name: h.name, pending: h.updates?.pending ?? 0, security: h.updates?.security ?? 0,
      // La fiche de l'hôte (paquets, bouton de mise à jour) est dans le monitoring.
      reboot: !!h.updates?.reboot_required, href: s.url ? `${s.url}/hosts/${h.id}` : "/monitoring",
    }))),
  });

/** Bouton de la barre latérale, au-dessus de Paramètres (bouton rond en haut de page sur mobile). */
export function NotificationsButton({ floating = false }: { floating?: boolean }) {
  return <NotificationsMenu url={MONITORING} toFeed={toFeed} floating={floating} alertsLink={["/monitoring", "Voir le monitoring"]} updatesLink={["/monitoring", "Voir le monitoring"]} />;
}
