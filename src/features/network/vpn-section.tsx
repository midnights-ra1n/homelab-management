"use client";

import Link from "next/link";
import { ArrowLeftRight, Pencil, Plus, ShieldCheck } from "lucide-react";
import { deleteVpnAction, saveVpnAction } from "@/actions/network";
import { Badge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/form";
import { AppIcon } from "@/features/apps/app-icon";
import { VPN_STATUSES, VPN_STATUS_META, VPN_TYPES, VPN_TYPE_META } from "@/lib/constants";
import type { VpnTunnel } from "@/lib/data/vpn";

type AssetOpt = { id: number; display_name: string };

export function VpnSection({ tunnels, assets }: { tunnels: VpnTunnel[]; assets: AssetOpt[] }) {
  return (
    <div className="grid gap-5">
      <div className="flex justify-end">
        <VpnDialog assets={assets} />
      </div>
      {tunnels.length === 0 ? (
        <EmptyState icon={<ShieldCheck size={22} />} title="Aucun tunnel VPN" action={<VpnDialog assets={assets} />}>
          Décris tes liens WireGuard, Tailscale, Headscale, NetBird, ZeroTier, OpenVPN ou IPsec : extrémités, réseau du tunnel et
          routes annoncées. Ils apparaissent sur la carte et dans la simulation.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {tunnels.map((t) => {
            const meta = VPN_TYPE_META[t.type];
            const status = VPN_STATUS_META[t.status];
            const b = t.endpoint_b_name ?? t.endpoint_b_label ?? "—";
            return (
              <li key={t.id} className="rounded-2xl border border-line-subtle bg-box p-5 sm:p-6">
                <div className="flex items-start gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-line-subtle bg-page">
                    <AppIcon type={meta.icon ? "selfhst" : "none"} value={meta.icon} name={meta.label} size={26} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-h1">{t.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <Badge tone={status.tone} dot>
                        {status.label}
                      </Badge>
                      {t.tunnel_cidr && <span className="font-mono text-xs text-meta">{t.tunnel_cidr}</span>}
                    </div>
                  </div>
                  <div className="-mr-2 -mt-1 flex">
                    <VpnDialog tunnel={t} assets={assets} />
                    <ConfirmButton action={() => deleteVpnAction(t.id)} message={`Supprimer le tunnel « ${t.name} » ?`} />
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <Endpoint name={t.endpoint_a_name ?? "—"} href={t.endpoint_a_id ? `/inventaire/${t.endpoint_a_id}` : undefined} ip={t.ip_a} lan={t.endpoint_a_ip} routes={t.routes_a} />
                  <ArrowLeftRight size={18} className="text-accent-text" aria-label="Tunnel" />
                  <Endpoint name={b} href={t.endpoint_b_id ? `/inventaire/${t.endpoint_b_id}` : undefined} ip={t.ip_b} lan={t.endpoint_b_ip} routes={t.routes_b} align="right" />
                </div>
                {(t.public_endpoint || t.listen_port) && (
                  <p className="mt-4 font-mono text-xs text-meta">
                    Endpoint public : {t.public_endpoint || "—"}
                    {t.listen_port ? ` · port ${t.listen_port}` : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Endpoint({
  name,
  href,
  ip,
  lan,
  routes,
  align = "left",
}: {
  name: string;
  href?: string;
  ip: string;
  lan: string | null;
  routes: string[];
  align?: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "min-w-0 text-right" : "min-w-0"}>
      {href ? (
        <Link href={href} className="block truncate font-medium text-h2 hover:text-accent-text">
          {name}
        </Link>
      ) : (
        <p className="truncate font-medium text-h2">{name}</p>
      )}
      <p className="truncate font-mono text-xs text-meta">
        {ip || "—"}
        {lan ? ` · LAN ${lan}` : ""}
      </p>
      {routes.length > 0 && <p className="mt-1 truncate font-mono text-[0.7rem] text-body">→ {routes.join(", ")}</p>}
    </div>
  );
}

function VpnDialog({ tunnel, assets }: { tunnel?: VpnTunnel; assets: AssetOpt[] }) {
  const assetOptions = assets.map((a) => ({ value: a.id, label: a.display_name }));
  return (
    <FormDialog
      title={tunnel ? `Modifier « ${tunnel.name} »` : "Nouveau tunnel VPN"}
      description="Les réseaux annoncés servent à la simulation : un paquet vers ces réseaux passe par le tunnel."
      action={saveVpnAction.bind(null, tunnel?.id ?? null)}
      trigger={tunnel ? undefined : "Tunnel VPN"}
      triggerVariant={tunnel ? "subtle" : "primary"}
      triggerSize={tunnel ? "icon-sm" : "md"}
      triggerIcon={tunnel ? <Pencil size={14} /> : <Plus size={16} />}
      triggerLabel={tunnel ? "Modifier le tunnel" : "Nouveau tunnel VPN"}
      size="lg"
    >
      <div className="grid gap-5 sm:grid-cols-3">
        <TextField label="Nom" name="name" defaultValue={tunnel?.name} placeholder="Site ↔ VPS" required className="sm:col-span-3" />
        <SelectField label="Technologie" name="type" defaultValue={tunnel?.type ?? "wireguard"} options={VPN_TYPES.map((t) => ({ value: t, label: VPN_TYPE_META[t].label }))} />
        <SelectField label="État" name="status" defaultValue={tunnel?.status ?? "up"} options={VPN_STATUSES.map((s) => ({ value: s, label: VPN_STATUS_META[s].label }))} />
        <TextField label="Réseau du tunnel" name="tunnel_cidr" defaultValue={tunnel?.tunnel_cidr} placeholder="10.8.0.0/24 · 100.64.0.0/10" className="font-mono" />
      </div>

      <div className="grid gap-5 rounded-2xl border border-line-subtle bg-page p-4 sm:grid-cols-2">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-meta sm:col-span-2">Extrémité A (locale)</p>
        <SelectField label="Élément" name="endpoint_a_id" defaultValue={tunnel?.endpoint_a_id ?? ""} placeholder="— Choisir —" options={assetOptions} />
        <TextField label="IP dans le tunnel" name="ip_a" defaultValue={tunnel?.ip_a} placeholder="10.8.0.1" className="font-mono" />
        <TextField
          label="Réseaux annoncés derrière A"
          name="routes_a"
          defaultValue={tunnel?.routes_a.join(", ")}
          placeholder="192.168.10.0/24, 192.168.20.0/24"
          hint="Son propre sous-réseau est inclus automatiquement"
          className="font-mono sm:col-span-2"
        />
      </div>

      <div className="grid gap-5 rounded-2xl border border-line-subtle bg-page p-4 sm:grid-cols-2">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-meta sm:col-span-2">Extrémité B (distante)</p>
        <SelectField label="Élément" name="endpoint_b_id" defaultValue={tunnel?.endpoint_b_id ?? ""} placeholder="— Hors inventaire —" options={assetOptions} />
        <TextField label="…ou nom" name="endpoint_b_label" defaultValue={tunnel?.endpoint_b_label} placeholder="VPS OVH, Téléphone…" />
        <TextField label="IP dans le tunnel" name="ip_b" defaultValue={tunnel?.ip_b} placeholder="10.8.0.2" className="font-mono" />
        <TextField label="Réseaux annoncés derrière B" name="routes_b" defaultValue={tunnel?.routes_b.join(", ")} placeholder="10.10.0.0/24" className="font-mono" />
      </div>

      <div className="grid gap-5 sm:grid-cols-[1fr_9rem]">
        <TextField label="Endpoint public" name="public_endpoint" defaultValue={tunnel?.public_endpoint} placeholder="vpn.example.fr" className="font-mono" />
        <TextField label="Port" name="listen_port" type="number" min={1} max={65535} defaultValue={tunnel?.listen_port ?? ""} placeholder="51820" className="font-mono" />
      </div>
      <TextAreaField label="Notes" name="notes" defaultValue={tunnel?.notes} rows={2} />
    </FormDialog>
  );
}
