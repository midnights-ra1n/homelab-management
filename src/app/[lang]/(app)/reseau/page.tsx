import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Network } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listTunnels } from "@/lib/data/vpn";
import { listRules } from "@/lib/data/firewall";
import { listDomains } from "@/lib/data/domains";
import { DomainSection } from "@/features/network/domain-section";
import { defaultFirewallPolicy } from "@/lib/data/settings";
import { listAssets } from "@/lib/data/assets";
import { diagnose } from "@/lib/net/engine";
import { loadSnapshot } from "@/lib/net/snapshot";
import { LinkTabs } from "@/components/ui/tabs";
import { Alert } from "@/components/ui/alert";
import { ASSET_KIND_META } from "@/lib/constants";
import { VpnSection } from "@/features/network/vpn-section";
import { FirewallSection } from "@/features/network/firewall-section";
import { Simulator } from "@/features/network/simulator";
import { Diagnostics } from "@/features/network/diagnostics";
import { assetOptions } from "@/lib/data/assets";
import { getSubnet, ipamTotals, listIps, listSubnets, listVlans, subnetOptions, type Subnet } from "@/lib/data/network";
import { deleteIpAction, deleteSubnetAction, deleteVlanAction } from "@/actions/network";
import { IP_STATUS_META, TONE_TEXT_VAR, TONE_VAR } from "@/lib/constants";
import { intToIp, ipToInt, parseCidr } from "@/lib/ip";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { IpDialog, SubnetDialog, VlanDialog } from "@/features/network/dialogs";
import { IpGrid, type GridCell } from "@/features/network/ip-grid";
import { cn, pct } from "@/lib/utils";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Réseau & IPAM") };
}

export default async function NetworkPage({ searchParams }: PageProps<"/[lang]/reseau">) {
  const tr = await getT();
  return (
    <>
      <PageHeader
        title={tr("Réseau")}
        description={tr("Adressage, tunnels VPN, pare-feu, noms de domaine et simulation de flux avant la mise en prod.")}
      />
      <Suspense fallback={<Skeleton className="h-[32rem] rounded-2xl" />}>
        <Ipam searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function usage(s: Subnet) {
  return pct(s.used + s.reserved + s.dhcp, s.capacity);
}

async function Ipam({ searchParams }: { searchParams: PageProps<"/[lang]/reseau">["searchParams"] }) {
  const tr = await getT();
  await requireUser();
  const sp = await searchParams;
  const tab = typeof sp.onglet === "string" ? sp.onglet : "adressage";
  const issues = diagnose(loadSnapshot());
  const errors = issues.filter((i) => i.level === "error").length;
  const tabs = (
    <LinkTabs
      label={tr("Sections réseau")}
      active={tab}
      className="mb-8"
      items={[
        { value: "adressage", label: tr("Adressage"), href: "/reseau" },
        { value: "vpn", label: "VPN", href: "/reseau?onglet=vpn" },
        { value: "pare-feu", label: "Pare-feu", href: "/reseau?onglet=pare-feu" },
        { value: "domaines", label: tr("Domaines"), href: "/reseau?onglet=domaines" },
        { value: "simulation", label: tr("Simulation"), href: "/reseau?onglet=simulation" },
        { value: "diagnostic", label: tr("Diagnostic"), href: "/reseau?onglet=diagnostic", count: issues.filter((i) => i.level !== "info").length },
      ]}
    />
  );

  if (tab !== "adressage") {
    const vlanList = listVlans();
    const subnetList = listSubnets();
    const tunnels = listTunnels();
    const assets = listAssets();
    const fwOptions = {
      vlans: vlanList.map((v) => ({ id: v.id, label: `VLAN ${v.vlan_id} · ${v.name}` })),
      subnets: subnetList.map((s) => ({ id: s.id, label: `${s.name} · ${s.cidr}` })),
      assets: assets.map((a) => ({ id: a.id, label: a.display_name })),
      tunnels: tunnels.map((t) => ({ id: t.id, label: t.name })),
    };
    return (
      <div>
        {tabs}
        {tab === "vpn" && <VpnSection tunnels={tunnels} assets={assets.map((a) => ({ id: a.id, display_name: a.display_name }))} />}
        {tab === "domaines" && <DomainSection domains={listDomains()} assets={assets.map((a) => ({ id: a.id, display_name: a.display_name }))} />}
        {tab === "pare-feu" && <FirewallSection rules={listRules()} policy={defaultFirewallPolicy()} options={fwOptions} />}
        {tab === "simulation" && (
          <Simulator
            assets={assets
              .filter((a) => a.status !== "decommissioned")
              .map((a) => ({ id: a.id, label: a.display_name, ip: a.primary_ip, group: ASSET_KIND_META[a.kind].plural }))}
          />
        )}
        {tab === "diagnostic" && <Diagnostics issues={issues} />}
      </div>
    );
  }

  const vlans = listVlans();
  const subnets = listSubnets();
  const totals = ipamTotals();
  const selectedId = Number(sp.subnet) || subnets[0]?.id;
  const selected = selectedId ? getSubnet(selectedId) : undefined;
  const orphans = listIps("none");
  const options = { subnets: subnetOptions(), assets: assetOptions() };

  return (
    <div>
      {tabs}
    <div className="grid grid-cols-1 gap-10 xl:gap-14">
      {errors > 0 && (
        <Alert kind="error" title={tr("{errors} problème(s) d'adressage", { errors: errors })}>
          <Link href="/reseau?onglet=diagnostic" className="underline underline-offset-2">
            {tr("Voir le diagnostic")}</Link>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4 xl:gap-8">
        <Stat label="VLAN" value={totals.vlans} />
        <Stat label={tr("Sous-réseaux")} value={totals.subnets} />
        <Stat label={tr("Adresses attribuées")} value={totals.used} detail={tr("sur {0} utilisables", { "0": totals.capacity.toLocaleString(tr.locale) })} />
        <Stat label={tr("Occupation globale")} value={`${pct(totals.used, totals.capacity)} %`} />
      </div>

      {/* VLAN */}
      <section aria-labelledby="vlans">
        <SectionTitle id="vlans" actions={<VlanDialog />}>
          {tr("VLAN")}</SectionTitle>
        {vlans.length === 0 ? (
          <EmptyState title={tr("Aucun VLAN")}>{tr("Déclare tes VLAN (802.1Q) pour segmenter ton réseau : serveurs, IoT, invités…")}</EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {vlans.map((v) => (
              <Card key={v.id} className="flex items-start gap-4 p-4">
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-mono text-sm font-semibold"
                  style={{
                    color: TONE_TEXT_VAR[v.color],
                    background: `color-mix(in srgb, ${TONE_VAR[v.color]} 14%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${TONE_VAR[v.color]} 35%, transparent)`,
                  }}
                >
                  {v.vlan_id}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-h1">{v.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-meta">
                    {v.subnet_count} {tr("sous-réseau(x) · ")}{v.asset_count} {tr("élément(s)")}</p>
                  {v.description && <p className="mt-1 line-clamp-2 text-xs text-body">{v.description}</p>}
                </div>
                <div className="-mr-1 -mt-1 flex">
                  <VlanDialog vlan={v} />
                  <ConfirmButton
                    action={deleteVlanAction.bind(null, v.id)}
                    message={tr("Supprimer le VLAN {vlan_id} « {name} » ? Les sous-réseaux associés seront conservés mais non tagués.", { vlan_id: v.vlan_id, name: v.name })}
                  />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Sous-réseaux */}
      <section aria-labelledby="subnets">
        <SectionTitle
          id="subnets"
          actions={
            <div className="flex gap-2">
              <IpDialog {...options} />
              <SubnetDialog vlans={vlans} />
            </div>
          }
        >
          {tr("Sous-réseaux")}</SectionTitle>
        {subnets.length === 0 ? (
          <EmptyState icon={<Network size={22} />} title={tr("Aucun sous-réseau")} action={<SubnetDialog vlans={vlans} />}>
            {tr("Ajoute un sous-réseau (ex. 192.168.10.0/24) pour visualiser son occupation et attribuer des adresses.")}</EmptyState>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[22rem_1fr]">
            <nav aria-label={tr("Sous-réseaux")} className="grid content-start gap-2">
              {subnets.map((s) => {
                const active = s.id === selected?.id;
                return (
                  <Link
                    key={s.id}
                    href={`/reseau?subnet=${s.id}`}
                    scroll={false}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "block rounded-2xl border p-4 transition-colors",
                      active ? "border-accent bg-accent-soft" : "border-line-subtle bg-box hover:border-line-strong",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-medium text-h1">{s.name}</span>
                      {s.vlan_number && (
                        <span className="shrink-0 font-mono text-xs" style={{ color: TONE_TEXT_VAR[s.vlan_color ?? "accent"] }}>
                          {tr("VLAN ")}{s.vlan_number}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 font-mono text-xs text-meta">{s.cidr}</p>
                    <Meter
                      className="mt-3"
                      size="sm"
                      value={usage(s)}
                      label={`${s.used + s.reserved + s.dhcp} / ${s.capacity}`}
                      detail={`${usage(s)} %`}
                    />
                  </Link>
                );
              })}
            </nav>

            {selected && <SubnetDetail subnet={selected} options={options} />}
          </div>
        )}
      </section>

      {orphans.length > 0 && (
        <section aria-labelledby="orphans">
          <SectionTitle id="orphans">{tr("Adresses hors sous-réseau déclaré")}</SectionTitle>
          <IpTable ips={orphans} options={options} />
        </section>
      )}
    </div>
    </div>
  );
}

async function SubnetDetail({
  subnet,
  options,
}: {
  subnet: Subnet;
  options: { subnets: ReturnType<typeof subnetOptions>; assets: ReturnType<typeof assetOptions> };
}) {
  const tr = await getT();
  const ips = listIps(subnet.id);
  const c = parseCidr(subnet.cidr)!;
  const byAddr = new Map(ips.map((i) => [i.address, i]));
  const gw = ipToInt(subnet.gateway);
  const ds = ipToInt(subnet.dhcp_start);
  const de = ipToInt(subnet.dhcp_end);
  const showGrid = c.size <= 1024;

  const cells: GridCell[] = [];
  if (showGrid) {
    for (let n = c.network; n < c.network + c.size; n++) {
      const address = intToIp(n);
      const ip = byAddr.get(address);
      let status: GridCell["status"] = "free";
      if (c.prefix < 31 && n === c.network) status = "network";
      else if (c.prefix < 31 && n === c.network + c.size - 1) status = "broadcast";
      else if (ip && ip.status !== "free") status = ip.status;
      else if (n === gw) status = "gateway";
      else if (ds !== null && de !== null && n >= ds && n <= de) status = "dhcp-range";
      cells.push({ address, last: n & 255, status, label: ip?.asset_name ?? ip?.hostname ?? ip?.description });
    }
  }

  return (
    <div className="grid min-w-0 content-start gap-6">
      <Card>
        <CardHeader
          overline={subnet.vlan_number ? `VLAN ${subnet.vlan_number} · ${subnet.vlan_name}` : tr("Non tagué")}
          title={
            <span>
              {subnet.name} <span className="ml-1 font-mono text-sm font-normal text-meta">{subnet.cidr}</span>
            </span>
          }
          actions={
            <>
              <SubnetDialog subnet={subnet} vlans={listVlans()} />
              <ConfirmButton
                action={deleteSubnetAction.bind(null, subnet.id)}
                message={tr("Supprimer le sous-réseau {cidr} ? Les adresses seront conservées sans sous-réseau.", { cidr: subnet.cidr })}
              />
            </>
          }
        />
        <CardBody className="grid grid-cols-1 gap-6">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              [tr("Passerelle"), subnet.gateway || "—"],
              ["DNS", subnet.dns || "—"],
              ["DHCP", subnet.dhcp_start ? `${subnet.dhcp_start} → ${subnet.dhcp_end.split(".").pop()}` : "—"],
              [tr("Libres"), `${subnet.capacity - subnet.used - subnet.reserved - subnet.dhcp}`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">{k}</dt>
                <dd className="mt-1 truncate font-mono text-sm text-h1">{v}</dd>
              </div>
            ))}
          </dl>
          {subnet.description && <p className="text-sm text-body">{subnet.description}</p>}
          {showGrid ? (
            <IpGrid cells={cells} subnetId={subnet.id} {...options} />
          ) : (
            <p className="text-sm text-meta">{tr("Grille masquée pour les sous-réseaux de plus de 1 024 adresses.")}</p>
          )}
        </CardBody>
      </Card>
      {ips.length > 0 && <IpTable ips={ips} options={options} />}
    </div>
  );
}

async function IpTable({
  ips,
  options,
}: {
  ips: ReturnType<typeof listIps>;
  options: { subnets: ReturnType<typeof subnetOptions>; assets: ReturnType<typeof assetOptions> };
}) {
  const tr = await getT();
  return (
    <>
      <ul className="grid gap-2 md:hidden">
        {ips.map((ip) => (
          <li key={ip.id} className="flex items-center gap-3 rounded-2xl border border-line-subtle bg-box p-4">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="font-mono text-h1">{ip.address}</span>
                <Badge tone={IP_STATUS_META[ip.status].tone}>{tr(IP_STATUS_META[ip.status].label)}</Badge>
              </span>
              <span className="mt-0.5 block truncate text-xs text-meta">
                {[ip.asset_name, ip.hostname || ip.mac, ip.description].filter(Boolean).join(" · ") || "—"}
              </span>
            </span>
            <IpDialog ip={ip} {...options} />
            <ConfirmButton
              action={deleteIpAction.bind(null, ip.id)}
              title={tr("Libérer l'adresse")}
              message={tr("Libérer {address} ?", { address: ip.address })}
              confirmLabel={tr("Libérer")}
            />
          </li>
        ))}
      </ul>
      <div className="hidden overflow-hidden rounded-2xl border border-line-subtle bg-box md:block">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead>
            <tr className="border-b border-line-subtle font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">
              <th className="px-5 py-3 font-medium">{tr("Adresse")}</th>
              <th className="px-3 py-3 font-medium">{tr("État")}</th>
              <th className="px-3 py-3 font-medium">{tr("Attribuée à")}</th>
              <th className="px-3 py-3 font-medium">{tr("DNS / MAC")}</th>
              <th className="px-3 py-3 font-medium">{tr("Description")}</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {ips.map((ip) => (
              <tr key={ip.id} className="border-b border-line-subtle last:border-0 hover:bg-elevated/50">
                <td className="px-5 py-2.5 font-mono text-h1">{ip.address}</td>
                <td className="px-3 py-2.5">
                  <Badge tone={IP_STATUS_META[ip.status].tone}>{tr(IP_STATUS_META[ip.status].label)}</Badge>
                </td>
                <td className="px-3 py-2.5">
                  {ip.asset_id ? (
                    <Link href={`/inventaire/${ip.asset_id}`} className="text-h2 hover:text-accent-text">
                      {ip.asset_name}
                    </Link>
                  ) : (
                    <span className="text-meta">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-body">
                  {ip.hostname || ip.mac || <span className="text-meta">—</span>}
                </td>
                <td className="max-w-[14rem] truncate px-3 py-2.5 text-body">{ip.description}</td>
                <td className="px-5 py-2.5">
                  <div className="flex justify-end">
                    <IpDialog ip={ip} {...options} />
                    <ConfirmButton
                      action={deleteIpAction.bind(null, ip.id)}
                      title={tr("Libérer l'adresse")}
                      message={tr("Libérer {address} ?", { address: ip.address })}
                      confirmLabel={tr("Libérer")}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </>
  );
}
