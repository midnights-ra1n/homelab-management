import { use } from "react";
import { ArrowDownUp, ExternalLink } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { hlmKind, StatusIcon } from "@/components/status-icon";
import { fetchHlm, type Source } from "@/lib/integrations";
import { api } from "@/lib/client";
import { getT } from "@/i18n/server";
import { LiveLink, useLiveBandwidth, type LiveSource, type LiveView } from "../../../shared/bandwidth";

// Uncached on purpose: get() would hand back the same reading until the next write.
const loadLive = async (): Promise<LiveSource[]> =>
  (await api.get<Source<LiveView>[]>("/api/mg/monitoring/bandwidth/live")).filter((s) => s.ok && s.data).map((s) => ({ key: String(s.id), view: s.data! }));

/** Live traffic of the interfaces watched by the monitoring's SNMP probes (same view as its Bande passante page). */
export function TrafficSection() {
  const tr = use(getT());
  const sources = use(fetchHlm());
  const live = useLiveBandwidth(loadLive);
  const links = sources.flatMap((s) => (s.data?.bandwidth?.links ?? []).map((l) => ({ ...l, source: s })));

  if (!sources.length) {
    return (
      <EmptyState icon={<ArrowDownUp size={20} />} title={tr("Monitoring non connecté")}
        action={<ButtonLink href="/parametres#integrations" variant="secondary" size="sm">{tr("Intégrations")}</ButtonLink>}>
        {tr("Le trafic vient des sondes SNMP de Midnights Monitoring : connecte-le dans les intégrations.")}
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-6">
      <p className="text-sm text-body">{tr("Débits lus directement sur les équipements SNMP toutes les 2 secondes, sur les 5 dernières minutes.")}</p>
      {sources.filter((s) => !s.ok).map((s) => (
        <Alert key={s.id} kind="error" title={tr("{name} : erreur", { name: s.name })}>{s.error}</Alert>
      ))}
      {live.error && <Alert kind="error" title={tr("Lecture en temps réel interrompue")}>{live.error}</Alert>}
      {links.length === 0 ? (
        <EmptyState icon={<ArrowDownUp size={20} />} title={tr("Aucune interface suivie")}>
          {tr("Dans Midnights Monitoring, crée une sonde SNMP « Débit entrant » et une « Débit sortant » sur l'interface WAN de ton routeur.")}
        </EmptyState>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {links.map((l) => (
            <Card key={`${l.source.id}|${l.target}|${l.interface}`}>
              <CardHeader
                overline={sources.length > 1 ? `${l.source.name} · ${l.target}` : l.target}
                title={<span className="flex items-center gap-2.5"><StatusIcon kind={hlmKind(l.status)} size={18} /><span className="font-mono">{l.interface}</span></span>}
                actions={
                  <ButtonLink href={`${l.source.url}/bandwidth`} target="_blank" rel="noreferrer" variant="ghost" size="sm" icon={<ExternalLink size={13} />}>
                    {tr("Historique")}
                  </ButtonLink>
                }
              />
              <CardBody className="grid gap-5">
                <LiveLink l={l} live={live} sourceKey={String(l.source.id)} />
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
