
import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { nextFreeIpAction } from "@/actions/network";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/form";
import { IpHint } from "@/features/network/ip-hint";
import type { AssetOption } from "@/lib/data/assets";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

export type SubnetOption = { id: number; name: string; cidr: string; vlan_number: number | null };

/** Sous-réseau + IP principale, avec proposition de la prochaine IP libre et pré-remplissage depuis l'hôte. */
export function useNetworkState(init: { subnetId?: number | null; ip?: string | null } = {}) {
  const [subnetId, setSubnetId] = useState(init.subnetId ? String(init.subnetId) : "");
  const [ip, setIp] = useState(init.ip ?? "");
  const [suggesting, start] = useTransition();
  const suggest = (id: number) =>
    start(async () => {
      const next = await nextFreeIpAction(id);
      if (next) setIp(next);
    });
  /** Hôte choisi : reprend son sous-réseau (si aucun n'est choisi) et propose une IP libre. */
  const fromHost = (host: AssetOption | undefined) => {
    if (!host?.subnet_id || subnetId) return;
    setSubnetId(String(host.subnet_id));
    if (!ip) suggest(host.subnet_id);
  };
  return { subnetId, setSubnetId, ip, setIp, suggesting, suggest, fromHost };
}

export function NetworkFields({
  net,
  subnets,
  assetId,
}: {
  net: ReturnType<typeof useNetworkState>;
  subnets: SubnetOption[];
  assetId?: number | null;
}) {
  const tr = useT();
  return (
    <>
      <Field label={tr("Sous-réseau")} name="primary_subnet_id">
        {(p) => (
          <select {...p} className={inputClass} value={net.subnetId} onChange={(e) => net.setSubnetId(e.target.value)}>
            <option value="">{tr("— Détection automatique —")}</option>
            {subnets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.cidr}
                {s.vlan_number ? ` · VLAN ${s.vlan_number}` : ""}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={tr("Adresse IP")} name="primary_ip">
        {(p) => (
          <>
            <div className="flex gap-2">
              <input
                {...p}
                className={cn(inputClass, "font-mono")}
                value={net.ip}
                onChange={(e) => net.setIp(e.target.value)}
                placeholder="192.168.10.20"
                inputMode="decimal"
              />
              <Button
                variant="secondary"
                size="icon"
                className="shrink-0"
                disabled={!net.subnetId || net.suggesting}
                title={tr("Proposer la prochaine IP libre")}
                aria-label={tr("Proposer la prochaine IP libre")}
                onClick={() => net.suggest(Number(net.subnetId))}
                icon={<Sparkles size={16} />}
              />
            </div>
            <IpHint address={net.ip} subnetId={net.subnetId ? Number(net.subnetId) : null} assetId={assetId ?? null} />
          </>
        )}
      </Field>
    </>
  );
}

const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

/** Message de contrôle d'une MAC pendant la saisie (vide si correcte ou non renseignée). */
export function macError(value: string) {
  const v = value.trim();
  return v && !MAC_RE.test(v) ? "Format attendu : aa:bb:cc:dd:ee:ff" : "";
}
