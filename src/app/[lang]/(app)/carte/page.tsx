import type { Metadata } from "next";
import { Suspense } from "react";
import { Share2, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listAssets } from "@/lib/data/assets";
import { listLinks, mapPositions } from "@/lib/data/map";
import { listSubnets, listVlans } from "@/lib/data/network";
import { listTunnels } from "@/lib/data/vpn";
import { VPN_TYPE_META } from "@/lib/constants";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { HomelabMap, type MapAsset } from "@/features/map/homelab-map";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Carte") };
}

export default async function MapPage() {
  const tr = await getT();
  return (
    <>
      <PageHeader
        title={tr("La topologie du homelab")}
        description={tr("Hôtes, invités, conteneurs et tunnels VPN reliés automatiquement. Déplace les nœuds, relie-les par glisser depuis les poignées, filtre par type ou VLAN.")}
      />
      <Suspense fallback={<Skeleton className="h-[36rem] rounded-3xl" />}>
        <MapView />
      </Suspense>
    </>
  );
}

async function MapView() {
  const tr = await getT();
  await requireUser();
  const assets = listAssets();
  if (assets.length === 0) {
    return (
      <EmptyState
        icon={<Share2 size={22} />}
        title={tr("Rien à cartographier")}
        action={
          <ButtonLink href="/inventaire/nouveau" icon={<Plus size={16} />}>
            {tr("Ajouter un élément")}</ButtonLink>
        }
      >
        {tr("La carte se construit à partir de l'inventaire et des relations hôte → invité.")}</EmptyState>
    );
  }
  const subnets = listSubnets();
  const vlanColor = new Map(subnets.map((s) => [s.vlan_number, s.vlan_color]));
  const mapAssets: MapAsset[] = assets.map((a) => ({
    id: a.id,
    name: a.display_name,
    hostname: a.hostname,
    kind: a.kind,
    status: a.status,
    ip: a.primary_ip,
    parent_id: a.parent_id,
    vlan: a.vlan_number,
    vlan_name: a.vlan_name,
    vlan_color: a.vlan_number ? (vlanColor.get(a.vlan_number) ?? "accent") : null,
    role: a.role,
  }));
  return (
    <HomelabMap
      assets={mapAssets}
      links={listLinks()}
      tunnels={listTunnels().map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        typeLabel: tr(VPN_TYPE_META[t.type].label),
        status: t.status,
        a: t.endpoint_a_id,
        b: t.endpoint_b_id,
        bLabel: t.endpoint_b_label,
      }))}
      vlans={listVlans().map((v) => ({ vlan_id: v.vlan_id, name: v.name, color: v.color }))}
      saved={mapPositions()}
    />
  );
}
