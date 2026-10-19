import { useState } from "react";
import { ArrowDownUp } from "lucide-react";
import { api, fmtNum, type Bandwidth, type BandwidthLink } from "../api";
import { BandwidthChart, BandwidthFigures, BandwidthVolume, LiveLink, useLiveBandwidth, type LiveSource, type LiveView } from "../shared/bandwidth";
import { Alert, Card, EmptyState, Link, PageHeader, SECTIONS, Segmented, Skeleton, StatusBadge, StatusIcon, usePoll } from "../ui";


type Range = "live" | "1h" | "24h" | "7d" | "30d";

const loadLive = async (): Promise<LiveSource[]> => [{ key: "0", view: await api.get<LiveView>("/api/bandwidth/live") }];

export function BandwidthPage() {
  const [range, setRange] = useState<Range>("live");
  // The live view lists the links from the last hour and reads their rates itself.
  const { data, error } = usePoll(() => api.get<Bandwidth>(`/api/bandwidth?range=${range === "live" ? "1h" : range}`), range === "live" ? 60000 : 30000, [range], ["metrics"]);
  return (
    <>
      <PageHeader title="Bande passante" description={range === "live"
        ? "Débits lus directement sur les équipements SNMP toutes les 2 secondes, sur les 5 dernières minutes. Les mêmes données sont affichées dans Midnights Management."
        : "Trafic entrant et sortant relevé par les sondes SNMP, et état des interfaces (VPN WireGuard…). Les mêmes données sont affichées dans Midnights Management."}
        actions={<Segmented label="Période" value={range} onChange={setRange} options={[["live", "Temps réel"], ["1h", "1 h"], ["24h", "24 h"], ["7d", "7 j"], ["30d", "30 j"]]} />} />
      {error && <Alert kind="error" title="Impossible de charger la bande passante" className="mb-6">{error}</Alert>}
      {!data && !error && <Skeleton className="h-64" />}
      {data && data.links.length === 0 && <BandwidthEmpty />}
      {data && data.links.length > 0 && (range === "live" ? <LiveLinks data={data} /> : (
        <div className={SECTIONS}>
          {data.links.map((l) => (
            <Card key={`${l.target}|${l.interface}`} title={<LinkTitle l={l} />} sub={l.target}>
              <div className="grid gap-5">
                <BandwidthFigures l={l} />
                {(l.in || l.out) && <BandwidthChart t={data.t} l={l} />}
                {(l.in || l.out) && <Volume days={data.days} l={l} />}
              </div>
            </Card>
          ))}
        </div>
      ))}
    </>
  );
}

function LiveLinks({ data }: { data: Bandwidth }) {
  const live = useLiveBandwidth(loadLive);
  return (
    <div className={SECTIONS}>
      {live.error && <Alert kind="error" title="Lecture en temps réel interrompue">{live.error}</Alert>}
      {data.links.map((l) => (
        <Card key={`${l.target}|${l.interface}`} title={<LinkTitle l={l} />} sub={l.target}>
          <div className="grid gap-5">
            <LiveLink l={l} live={live} sourceKey="0" />
            {(l.in || l.out) && <Volume days={data.days} l={l} />}
          </div>
        </Card>
      ))}
    </div>
  );
}

export function BandwidthEmpty() {
  return (
    <EmptyState icon={<ArrowDownUp size={20} />} title="Aucune interface suivie" action={<Link to="/monitors">Ajouter une sonde SNMP</Link>}>
      Crée une sonde SNMP avec la mesure « Débit entrant » et une autre avec « Débit sortant » sur la même interface (WAN de ton routeur, par exemple),
      et « État d'une interface » pour un tunnel WireGuard.
    </EmptyState>
  );
}

function LinkTitle({ l }: { l: BandwidthLink }) {
  return (
    <span className="flex items-center gap-2.5">
      <StatusIcon status={l.status} size={18} /><span className="font-mono">{l.interface}</span><StatusBadge status={l.status} />
      {l.speed_mbps != null && <span className="font-mono text-xs font-normal text-meta">lien {l.speed_mbps >= 1000 ? `${fmtNum(l.speed_mbps / 1000, 1)} Gbit/s` : `${fmtNum(l.speed_mbps, 0)} Mbit/s`}</span>}
    </span>
  );
}

function Volume({ days, l }: { days: number[]; l: BandwidthLink }) {
  return (
    <div className="grid gap-2">
      <p className="text-xs text-meta">Volume de données par jour, 31 derniers jours</p>
      <BandwidthVolume days={days} l={l} />
    </div>
  );
}
