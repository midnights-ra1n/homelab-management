
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { NotificationsMenu, type NotifFeed } from "../../shared/notifications";
import { usePolled } from "../../shared/poll";
import { TONE_VAR } from "@/lib/constants";
import type { MonitorAlert } from "@/lib/monitor/alerts";
import { usePathname, useT } from "@/i18n/client";
import { StatusIcon } from "./status-icon";
import { ButtonLink } from "@/components/ui/button";
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
    color: TONE_VAR[critical ? "red" : "yellow"],
    title: critical ? tr("{n} incident(s) en cours", { n: critical }) : tr("{n} point(s) d'attention", { n: alerts.length }),
  };
}

/** Bannière du tableau de bord : grande, liste les alertes. */
export function AlertBanner({ initial }: { initial: MonitorAlert[] }) {
  const tr = useT();
  // Une alerte change : on rafraîchit aussi le widget Monitoring rendu côté serveur.
  const alerts = useAlerts(initial, true);
  if (!alerts.length) return null;
  const { critical, color, title } = summary(alerts, tr);
  return (
    <section
      role={critical ? "alert" : "status"}
      className="rounded-2xl border p-5 sm:p-6"
      style={{
        background: `color-mix(in srgb, ${color} 12%, var(--mm-surface))`,
        borderColor: `color-mix(in srgb, ${color} 50%, var(--mm-border))`,
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: color, color: "var(--mm-surface)" }}>
          <AlertTriangle size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold sm:text-xl" style={{ color }}>
            {title}
          </p>
          {critical > 0 && alerts.length > critical && (
            <p className="text-sm text-meta">{tr("+ {n} avertissement(s)", { n: alerts.length - critical })}</p>
          )}
        </div>
        <ButtonLink href="/monitoring" variant="secondary" size="sm" icon={<ArrowUpRight size={14} />}>
          {tr("Voir le monitoring")}
        </ButtonLink>
      </div>
      <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
        {alerts.slice(0, 6).map((a, i) => (
          <li key={i}>
            <Link href={a.href} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-page">
              <StatusIcon kind={a.tone === "red" ? "down" : "warn"} size={15} />
              <span className="truncate text-h1">{a.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Version discrète pour les autres pages : une ligne, masquée sur le tableau de bord. */
export function AlertStrip() {
  const tr = useT();
  const pathname = usePathname();
  const alerts = useAlerts(null);
  // Accueil et Monitoring ont leur propre bandeau d'alertes.
  if (!alerts.length || pathname === "/" || pathname === "/monitoring") return null;
  const { critical, color, title } = summary(alerts, tr);
  return (
    <Link
      href="/monitoring"
      role={critical ? "alert" : "status"}
      className="mb-6 flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors hover:brightness-110"
      style={{
        background: `color-mix(in srgb, ${color} 8%, var(--mm-surface))`,
        borderColor: `color-mix(in srgb, ${color} 35%, var(--mm-border))`,
      }}
    >
      <AlertTriangle size={14} className="shrink-0" style={{ color }} aria-hidden="true" />
      <span className="shrink-0 font-medium" style={{ color }}>
        {title}
      </span>
      <span className="min-w-0 flex-1 truncate text-meta">{alerts[0].text}</span>
      <ArrowUpRight size={14} className="shrink-0 text-meta" aria-hidden="true" />
    </Link>
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
