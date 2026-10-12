import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Copy, ExternalLink, Pencil, Plus, SquareTerminal, Star } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { assetOptions, childrenOf, getAsset, type Asset } from "@/lib/data/assets";
import { ipsForAsset, subnetOptions } from "@/lib/data/network";
import { listDeployments } from "@/lib/data/deployments";
import { listTasks } from "@/lib/data/tasks";
import { getIntegration } from "@/lib/data/integrations";
import { fetchBeszel, fetchPatchmon } from "@/lib/integrations";
import { guestConsoleUrl } from "@/lib/integrations/proxmox";
import { consoleHref } from "@/features/proxmox/console-href";
import {
  ASSET_KIND_META,
  ASSET_STATUS_META,
  DEPLOYMENT_STATUS_META,
  DISK_TYPE_LABEL,
  IP_STATUS_META,
  STATUS_SOURCE_LABEL,
  TASK_STATUS_META,
} from "@/lib/constants";
import { deleteAssetAction, duplicateAssetAction } from "@/actions/inventory";
import { deleteIpAction, setPrimaryIpAction } from "@/actions/network";
import { Badge, StatusDot, Tag } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Meter } from "@/components/ui/meter";
import { Skeleton } from "@/components/ui/skeleton";
import { KindAvatar } from "@/components/kind-icon";
import { IpDialog } from "@/features/network/dialogs";
import { resourceSummary } from "@/features/inventory/asset-table";
import { cn, formatDate, formatDateTime, formatGb, formatUptime, timeAgo } from "@/lib/utils";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Fiche élément") };
}

export default function AssetPage({ params }: PageProps<"/[lang]/inventaire/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[36rem] rounded-2xl" />}>
      <AssetDetail params={params} />
    </Suspense>
  );
}

function Spec({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line-subtle py-2.5 last:border-0">
      <dt className="shrink-0 text-sm text-meta">{label}</dt>
      <dd className={cn("min-w-0 truncate text-right text-sm text-h2", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

async function AssetDetail({ params }: { params: PageProps<"/[lang]/inventaire/[id]">["params"] }) {
  const tr = await getT();
  await requireUser();
  const id = Number((await params).id);
  const asset = getAsset(id);
  if (!asset) notFound();

  const children = childrenOf(id);
  const ips = ipsForAsset(id);
  const deployments = listDeployments().filter((d) => d.asset_id === id || d.target_host_id === id);
  const tasks = listTasks({ asset: id });
  const status = ASSET_STATUS_META[asset.status];
  const kindMeta = ASSET_KIND_META[asset.kind];
  const totalDisk = asset.disks.reduce((n, d) => n + (d.capacity_gb ?? 0), 0);
  const proxmox = asset.proxmox_integration_id ? getIntegration(asset.proxmox_integration_id) : undefined;
  const canHost = asset.kind === "physical" || asset.kind === "vm" || asset.kind === "lxc";
  const isPhysical = asset.kind === "physical" || asset.kind === "network" || asset.kind === "other";

  return (
    <div className="grid grid-cols-1 gap-8 xl:gap-10">
      {/* En-tête */}
      <header className="rise flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="flex items-start gap-5">
          <KindAvatar kind={asset.kind} size="lg" />
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-h1 sm:text-4xl">{asset.display_name}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {asset.hostname && <span className="font-mono text-sm text-body">{asset.hostname}</span>}
              <Link href={`/inventaire?kind=${asset.kind}`}>
                <Badge tone={kindMeta.tone}>{tr(kindMeta.label)}</Badge>
              </Link>
              {asset.parent_id && (
                <Link href={`/inventaire/${asset.parent_id}`} className="text-sm text-meta hover:text-accent-text">
                  {tr("sur ")}{asset.parent_name}
                </Link>
              )}
              <Badge tone={status.tone} icon={<StatusDot tone={status.tone} ping={asset.status === "online"} className="h-2 w-2" />}>
                {tr(status.label)}
              </Badge>
              {asset.status_source && asset.status_checked_at && (
                <span className="text-xs text-meta" title={formatDateTime(asset.status_checked_at, tr.locale)}>
                  {tr("via {source} · {when}", {
                    source: tr(STATUS_SOURCE_LABEL[asset.status_source] ?? asset.status_source),
                    when: timeAgo(asset.status_checked_at, tr.locale),
                  })}
                </span>
              )}
              {asset.role && <Badge tone="muted">{asset.role}</Badge>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {asset.management_url && (
            <ButtonLink href={asset.management_url} target="_blank" rel="noreferrer" variant="secondary" icon={<ExternalLink size={15} />}>
              {tr("Administrer")}</ButtonLink>
          )}
          <ButtonLink href={`/inventaire/${id}/modifier`} icon={<Pencil size={15} />}>
            {tr("Modifier")}</ButtonLink>
          <form action={duplicateAssetAction.bind(null, id)}>
            <Button type="submit" variant="subtle" size="icon" aria-label={tr("Dupliquer")} title={tr("Dupliquer")} icon={<Copy size={16} />} />
          </form>
          <ConfirmButton
            action={deleteAssetAction.bind(null, id)}
            size="icon"
            message={
              <>
                {tr("Supprimer ")}<strong className="text-h1">{asset.display_name}</strong> {tr("? Ses adresses IP seront libérées")}{children.length > 0 && tr(" et {length} élément(s) hébergé(s) seront détachés", { length: children.length })}.
              </>
            }
          />
        </div>
      </header>

      {asset.tags.length > 0 && (
        <div className="-mt-4 flex flex-wrap gap-1.5">
          {asset.tags.map((t) => (
            <Link key={t} href={`/inventaire?tag=${encodeURIComponent(t)}`}>
              <Tag>{t}</Tag>
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-3 xl:gap-10">
        <div className="grid min-w-0 content-start gap-6 lg:col-span-2">
          {/* Matériel / ressources */}
          {asset.kind !== "docker" && (
            <Card>
              <CardHeader
                overline={isPhysical ? tr("Configuration matérielle") : tr("Ressources allouées")}
                title={resourceSummary(asset, tr) || tr("Non renseigné")}
              />
              <CardBody className="grid gap-8 md:grid-cols-2">
                <dl>
                  {isPhysical && (
                    <>
                      <Spec label={tr("Fabricant")} value={asset.manufacturer} />
                      <Spec label={tr("Modèle")} value={asset.model} />
                      <Spec label={tr("N° de série")} value={asset.serial_number} mono />
                    </>
                  )}
                  <Spec label={tr("Processeur")} value={asset.cpu_model} />
                  <Spec label={tr("Sockets")} value={asset.cpu_sockets} mono />
                  <Spec label={asset.kind === "vm" || asset.kind === "lxc" ? "vCPU" : tr("Cœurs")} value={asset.cpu_cores} mono />
                  <Spec label={tr("Threads")} value={asset.cpu_threads} mono />
                  <Spec label={tr("Mémoire")} value={asset.ram_gb ? `${+asset.ram_gb} Go ${asset.ram_type}`.trim() : null} mono />
                  <Spec label={tr("GPU / accélérateur")} value={asset.gpu} />
                  <Spec label={tr("Consommation")} value={asset.power_watts ? `${asset.power_watts} W` : null} mono />
                  <Spec label={tr("Système")} value={[asset.os, asset.os_version].filter(Boolean).join(" ")} />
                  <Spec label={tr("Emplacement")} value={asset.location} />
                </dl>
                <div>
                  <p className="mb-3 flex items-baseline justify-between text-sm">
                    <span className="font-medium text-h1">{tr("Stockage")}</span>
                    <span className="font-mono text-xs text-meta">{totalDisk ? formatGb(totalDisk, tr.locale) : "—"}</span>
                  </p>
                  {asset.disks.length === 0 ? (
                    <p className="text-sm text-meta">{tr("Aucun disque renseigné.")}</p>
                  ) : (
                    <ul className="grid gap-2">
                      {asset.disks.map((d, i) => (
                        <li key={i} className="rounded-xl border border-line-subtle bg-page px-3 py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-sm text-h2">{d.name || tr("Disque {0}", { "0": i + 1 })}</span>
                            <span className="shrink-0 font-mono text-xs text-h2">{formatGb(d.capacity_gb, tr.locale)}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-3 text-xs text-meta">
                            <span>{DISK_TYPE_LABEL[d.type as keyof typeof DISK_TYPE_LABEL] ?? d.type}</span>
                            <span className="truncate">{d.usage}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardBody>
            </Card>
          )}

          {asset.kind === "docker" && (
            <Card>
              <CardHeader overline={tr("Docker")} title={asset.docker_image || tr("Image non renseignée")} />
              <CardBody>
                <dl>
                  <Spec label={tr("Ports")} value={asset.docker_ports} mono />
                  <Spec label="Stack / Compose" value={asset.docker_compose} />
                  <Spec label={tr("Système")} value={[asset.os, asset.os_version].filter(Boolean).join(" ")} />
                </dl>
              </CardBody>
            </Card>
          )}

          {/* Hébergés */}
          {(canHost || children.length > 0) && (
            <Card>
              <CardHeader
                overline={tr("Hébergés")}
                title={tr("{length} élément(s)", { length: children.length })}
                actions={
                  canHost && (
                    <ButtonLink
                      href={`/inventaire/nouveau?kind=${asset.kind === "physical" ? "vm" : "docker"}&parent=${id}`}
                      variant="ghost"
                      size="sm"
                      icon={<Plus size={14} />}
                    >
                      {tr("Ajouter")}</ButtonLink>
                  )
                }
              />
              <CardBody>
                {children.length === 0 ? (
                  <p className="text-sm text-meta">{tr("Rien n'est encore rattaché à cet élément.")}</p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {children.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/inventaire/${c.id}`}
                          className="flex items-center gap-3 rounded-xl border border-line-subtle bg-page p-3 transition-colors hover:border-line-accent"
                        >
                          <KindAvatar kind={c.kind} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-h1">{c.display_name}</span>
                            <span className="block truncate font-mono text-xs text-meta">
                              {c.primary_ip ?? c.hostname}
                              {c.proxmox_vmid ? ` · ${c.proxmox_vmid}` : ""}
                            </span>
                          </span>
                          <StatusDot tone={ASSET_STATUS_META[c.status].tone} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          )}

          {(asset.description || asset.notes) && (
            <Card>
              <CardHeader overline={tr("Notes")} title="Description & notes" />
              <CardBody className="grid gap-4">
                {asset.description && <p className="whitespace-pre-line text-sm leading-relaxed text-body">{asset.description}</p>}
                {asset.notes && (
                  <pre className="whitespace-pre-wrap rounded-xl border border-line-subtle bg-crust p-4 font-mono text-xs leading-relaxed text-body">
                    {asset.notes}
                  </pre>
                )}
              </CardBody>
            </Card>
          )}

          {(deployments.length > 0 || tasks.length > 0) && (
            <Card>
              <CardHeader overline={tr("Suivi")} title={tr("Déploiements & tâches liés")} />
              <CardBody className="grid gap-2">
                {deployments.map((d) => (
                  <Link
                    key={`d${d.id}`}
                    href={`/deploiements/${d.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line-subtle bg-page px-4 py-3 hover:border-line-accent"
                  >
                    <span className="truncate text-sm text-h2">{d.title}</span>
                    <Badge tone={DEPLOYMENT_STATUS_META[d.status].tone}>{tr(DEPLOYMENT_STATUS_META[d.status].label)}</Badge>
                  </Link>
                ))}
                {tasks.map((t) => (
                  <Link
                    key={`t${t.id}`}
                    href="/taches"
                    className="flex items-center justify-between gap-3 rounded-xl border border-line-subtle bg-page px-4 py-3 hover:border-line-accent"
                  >
                    <span className="truncate text-sm text-h2">{t.title}</span>
                    <Badge tone={TASK_STATUS_META[t.status].tone}>{tr(TASK_STATUS_META[t.status].label)}</Badge>
                  </Link>
                ))}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="grid min-w-0 content-start gap-6">
          {/* Réseau */}
          <Card>
            <CardHeader
              overline={tr("Réseau")}
              title={asset.primary_ip ?? tr("Aucune adresse")}
              actions={<IpDialog compact subnets={subnetOptions()} assets={assetOptions()} defaultAsset={id} />}
            />
            <CardBody className="grid gap-4">
              {asset.vlan_number && (
                <p className="text-sm text-body">
                  {tr("VLAN ")}<span className="font-mono text-h1">{asset.vlan_number}</span> · {asset.vlan_name}
                  {asset.subnet_cidr && (
                    <Link href={`/reseau?subnet=${asset.subnet_id}`} className="ml-1 font-mono text-meta hover:text-accent-text">
                      ({asset.subnet_cidr})
                    </Link>
                  )}
                </p>
              )}
              {ips.length > 0 && (
                <ul className="grid gap-2">
                  {ips.map((ip) => (
                    <li key={ip.id} className="flex items-center gap-2 rounded-xl border border-line-subtle bg-page px-3 py-2">
                      {ip.is_primary ? (
                        <Star size={14} className="shrink-0 fill-accent text-accent" aria-label={tr("Adresse principale")} />
                      ) : (
                        <form action={setPrimaryIpAction.bind(null, ip.id)}>
                          <button type="submit" title={tr("Définir comme principale")} aria-label={tr("Définir comme principale")} className="text-meta hover:text-accent-text">
                            <Star size={14} />
                          </button>
                        </form>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-sm text-h1">{ip.address}</span>
                        {(ip.mac || ip.description) && <span className="block truncate font-mono text-xs text-meta">{ip.mac || ip.description}</span>}
                      </span>
                      <Badge tone={IP_STATUS_META[ip.status].tone}>{tr(IP_STATUS_META[ip.status].label)}</Badge>
                      <ConfirmButton
                        action={deleteIpAction.bind(null, ip.id)}
                        title={tr("Libérer l'adresse")}
                        message={tr("Libérer {address} ?", { address: ip.address })}
                        confirmLabel={tr("Libérer")}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {asset.nics.length > 0 && (
                <div>
                  <p className="mb-2 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">{tr("Interfaces")}</p>
                  <dl>
                    {asset.nics.map((n, i) => (
                      <Spec key={i} label={n.name || `nic${i}`} value={`${n.mac || "—"} · ${n.speed}`} mono />
                    ))}
                  </dl>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Monitoring en direct */}
          <Suspense fallback={<Skeleton className="h-40 rounded-2xl" />}>
            <LiveMonitoring asset={asset} />
          </Suspense>

          {/* Proxmox */}
          {proxmox && asset.proxmox_vmid && (
            <Card>
              <CardHeader overline={tr("Proxmox")} title={`${proxmox.name} · ${asset.proxmox_node}`} />
              <CardBody className="flex items-center justify-between gap-3">
                <span className="font-mono text-sm text-body">{tr("VMID ")}{asset.proxmox_vmid}</span>
                <span className="flex gap-1">
                <ButtonLink
                  href={consoleHref({
                    integrationId: proxmox.id,
                    node: asset.proxmox_node,
                    type: asset.kind === "lxc" ? "lxc" : "qemu",
                    vmid: asset.proxmox_vmid,
                    name: asset.display_name,
                  })}
                  variant="ghost"
                  size="sm"
                  icon={<SquareTerminal size={14} />}
                >
                  {tr("Console")}</ButtonLink>
                <ButtonLink
                  href={guestConsoleUrl(proxmox.url, asset.kind === "lxc" ? "lxc" : "qemu", asset.proxmox_vmid)}
                  target="_blank"
                  rel="noreferrer"
                  variant="ghost"
                  size="sm"
                  icon={<ExternalLink size={14} />}
                >
                  {tr("Ouvrir")}</ButtonLink>
                </span>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardBody>
              <dl>
                <Spec label={tr("Ajouté le")} value={formatDate(asset.created_at, tr.locale)} />
                <Spec label={tr("Modifié")} value={<span title={formatDateTime(asset.updated_at, tr.locale)}>{timeAgo(asset.updated_at, tr.locale)}</span>} />
                <Spec label={tr("Identifiant")} value={`#${asset.id}`} mono />
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Rapproche l'élément des systèmes Beszel et hôtes PatchMon (hostname, nom ou IP). */
async function LiveMonitoring({ asset }: { asset: Asset }) {
  const tr = await getT();
  const [beszel, patchmon] = await Promise.all([fetchBeszel(), fetchPatchmon()]);
  if (beszel.length === 0 && patchmon.length === 0) return null;
  const keys = new Set(
    [asset.hostname, asset.display_name, asset.primary_ip].filter(Boolean).map((k) => k!.toLowerCase()),
  );
  const match = (...values: (string | undefined)[]) =>
    values.some((v) => v && (keys.has(v.toLowerCase()) || keys.has(v.toLowerCase().split(".")[0])));
  const system = beszel.flatMap((s) => s.data ?? []).find((s) => match(s.name, s.host, s.hostname));
  const host = patchmon.flatMap((s) => s.data ?? []).find((h) => match(h.hostname, h.friendlyName, h.ip));

  return (
    <Card>
      <CardHeader overline={tr("Monitoring")} title={system || host ? tr("Données en direct") : tr("Aucune correspondance")} />
      <CardBody className="grid gap-4">
        {!system && !host && (
          <p className="text-sm text-meta">
            {tr("Aucun système Beszel ni hôte PatchMon ne correspond au nom d'hôte, au nom ou à l'IP de cet élément.")}</p>
        )}
        {system && (
          <div className="grid gap-3">
            <p className="flex items-center justify-between text-sm">
              <span className="text-h2">{tr("Beszel · ")}{system.name}</span>
              <Badge tone={system.status === "up" ? "green" : "red"} dot>
                {system.status === "up" ? tr("En ligne") : system.status}
              </Badge>
            </p>
            <Meter label="CPU" value={system.cpu} />
            <Meter label={tr("Mémoire")} value={system.mem} />
            <Meter label={tr("Disque")} value={system.disk} />
            <p className="font-mono text-xs text-meta">
              {tr("Uptime ")}{formatUptime(system.uptime, tr.locale)}
              {system.temperature ? ` · ${Math.round(system.temperature)} °C` : ""}
            </p>
          </div>
        )}
        {host && (
          <div className="grid gap-2 border-t border-line-subtle pt-4 first:border-0 first:pt-0">
            <p className="flex items-center justify-between text-sm">
              <span className="text-h2">{tr("PatchMon · ")}{host.friendlyName}</span>
              {host.needsReboot && <Badge tone="yellow">{tr("Redémarrage requis")}</Badge>}
            </p>
            <p className="text-sm text-body">
              <span className="font-mono text-h1">{host.updates}</span> {tr("mise(s) à jour dont")}{" "}
              <span className={cn("font-mono", host.securityUpdates ? "text-red" : "text-h1")}>{host.securityUpdates}</span> {tr("de sécurité")}</p>
            <p className="font-mono text-xs text-meta">
              {host.osType} {host.osVersion}
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
