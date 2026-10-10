"use client";

import { Pencil, Plus } from "lucide-react";
import { saveIpAction, saveSubnetAction, saveVlanAction } from "@/actions/network";
import { FormDialog } from "@/components/ui/form-dialog";
import { ActionForm, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { useState } from "react";
import { IpHint } from "./ip-hint";
import { ASSET_KIND_META, IP_STATUSES, IP_STATUS_META, TONES, type AssetKind } from "@/lib/constants";
import type { IpAddress, Subnet, Vlan } from "@/lib/data/network";

const TONE_LABEL: Record<string, string> = {
  accent: "Menthe",
  green: "Vert",
  yellow: "Jaune",
  red: "Rouge",
  blue: "Bleu",
  purple: "Violet",
  cyan: "Cyan",
  orange: "Orange",
  pink: "Rose",
  muted: "Gris",
};

export function VlanDialog({ vlan }: { vlan?: Vlan }) {
  return (
    <FormDialog
      title={vlan ? `Modifier le VLAN ${vlan.vlan_id}` : "Nouveau VLAN"}
      action={saveVlanAction.bind(null, vlan?.id ?? null)}
      trigger={vlan ? undefined : "VLAN"}
      triggerVariant={vlan ? "subtle" : "secondary"}
      triggerSize={vlan ? "icon-sm" : "md"}
      triggerIcon={vlan ? <Pencil size={14} /> : <Plus size={16} />}
      triggerLabel={vlan ? "Modifier le VLAN" : "Nouveau VLAN"}
      size="sm"
    >
      <div className="grid gap-5 sm:grid-cols-[8rem_1fr]">
        <TextField label="VLAN ID" name="vlan_id" type="number" min={1} max={4094} defaultValue={vlan?.vlan_id} required className="font-mono" />
        <TextField label="Nom" name="name" defaultValue={vlan?.name} placeholder="Serveurs" required />
      </div>
      <SelectField
        label="Couleur"
        name="color"
        defaultValue={vlan?.color ?? "accent"}
        options={TONES.map((t) => ({ value: t, label: TONE_LABEL[t] }))}
        hint="Utilisée sur la carte et dans l'IPAM"
      />
      <TextAreaField label="Description" name="description" defaultValue={vlan?.description} rows={2} />
    </FormDialog>
  );
}

export function SubnetDialog({ subnet, vlans }: { subnet?: Subnet; vlans: Vlan[] }) {
  return (
    <FormDialog
      title={subnet ? `Modifier ${subnet.cidr}` : "Nouveau sous-réseau"}
      action={saveSubnetAction.bind(null, subnet?.id ?? null)}
      trigger={subnet ? undefined : "Sous-réseau"}
      triggerVariant={subnet ? "subtle" : "primary"}
      triggerSize={subnet ? "icon-sm" : "md"}
      triggerIcon={subnet ? <Pencil size={14} /> : <Plus size={16} />}
      triggerLabel={subnet ? "Modifier le sous-réseau" : "Nouveau sous-réseau"}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label="Nom" name="name" defaultValue={subnet?.name} placeholder="LAN serveurs" required />
        <TextField label="CIDR" name="cidr" defaultValue={subnet?.cidr} placeholder="192.168.10.0/24" required className="font-mono" />
        <SelectField
          label="VLAN"
          name="vlan_id"
          defaultValue={subnet?.vlan_id ?? ""}
          placeholder="— Non tagué —"
          options={vlans.map((v) => ({ value: v.id, label: `${v.vlan_id} · ${v.name}` }))}
        />
        <TextField label="Passerelle" name="gateway" defaultValue={subnet?.gateway} placeholder="192.168.10.1" className="font-mono" />
        <TextField label="Serveurs DNS" name="dns" defaultValue={subnet?.dns} placeholder="192.168.10.53, 1.1.1.1" className="font-mono sm:col-span-2" />
        <TextField label="Début DHCP" name="dhcp_start" defaultValue={subnet?.dhcp_start} placeholder="192.168.10.100" className="font-mono" />
        <TextField label="Fin DHCP" name="dhcp_end" defaultValue={subnet?.dhcp_end} placeholder="192.168.10.199" className="font-mono" />
      </div>
      <TextAreaField label="Description" name="description" defaultValue={subnet?.description} rows={2} />
    </FormDialog>
  );
}

export function IpDialog({
  ip,
  subnets,
  assets,
  defaultSubnet,
  defaultAsset,
  defaultAddress,
  compact,
}: {
  ip?: IpAddress;
  subnets: { id: number; name: string; cidr: string }[];
  assets: { id: number; display_name: string; kind: AssetKind }[];
  defaultSubnet?: number;
  defaultAsset?: number;
  defaultAddress?: string;
  compact?: boolean;
}) {
  return (
    <FormDialog
      title={ip ? `Modifier ${ip.address}` : "Attribuer une adresse"}
      action={saveIpAction.bind(null, ip?.id ?? null)}
      trigger={ip || compact ? undefined : "Adresse IP"}
      triggerVariant={ip || compact ? "subtle" : "secondary"}
      triggerSize={ip || compact ? "icon-sm" : "md"}
      triggerIcon={ip ? <Pencil size={14} /> : <Plus size={compact ? 14 : 16} />}
      triggerLabel={ip ? "Modifier l'adresse" : defaultAddress ? `Attribuer ${defaultAddress}` : "Ajouter une adresse IP"}
    >
      <IpFields ip={ip} subnets={subnets} assets={assets} defaultSubnet={defaultSubnet} defaultAsset={defaultAsset} defaultAddress={defaultAddress} />
    </FormDialog>
  );
}

type IpFieldsProps = {
  ip?: IpAddress;
  subnets: { id: number; name: string; cidr: string }[];
  assets: { id: number; display_name: string; kind: AssetKind }[];
  defaultSubnet?: number;
  defaultAsset?: number;
  defaultAddress?: string;
};

export function IpFields({ ip, subnets, assets, defaultSubnet, defaultAsset, defaultAddress }: IpFieldsProps) {
  const [address, setAddress] = useState(ip?.address ?? defaultAddress ?? "");
  const [subnet, setSubnet] = useState(String(ip?.subnet_id ?? defaultSubnet ?? ""));
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <TextField
            label="Adresse IPv4"
            name="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="192.168.10.42"
            required
            className="font-mono"
          />
          <IpHint address={address} subnetId={subnet ? Number(subnet) : null} ipId={ip?.id ?? null} />
        </div>
        <SelectField
          label="État"
          name="status"
          defaultValue={ip?.status ?? (defaultAsset ? "used" : "reserved")}
          options={IP_STATUSES.map((s) => ({ value: s, label: IP_STATUS_META[s].label }))}
        />
        <SelectField
          label="Sous-réseau"
          name="subnet_id"
          value={subnet}
          onChange={(e) => setSubnet(e.target.value)}
          placeholder="— Détection automatique —"
          options={subnets.map((s) => ({ value: s.id, label: `${s.name} · ${s.cidr}` }))}
        />
        <SelectField
          label="Attribuée à"
          name="asset_id"
          defaultValue={ip?.asset_id ?? defaultAsset ?? ""}
          placeholder="— Aucun élément —"
          options={assets.map((a) => ({ value: a.id, label: `${a.display_name} · ${ASSET_KIND_META[a.kind].label}` }))}
        />
        <TextField label="Nom d'hôte / DNS" name="hostname" defaultValue={ip?.hostname} placeholder="nas.lan" className="font-mono" />
        <TextField label="Adresse MAC" name="mac" defaultValue={ip?.mac} placeholder="aa:bb:cc:dd:ee:ff" className="font-mono" />
      </div>
      <TextField label="Description" name="description" defaultValue={ip?.description} placeholder="VIP keepalived, imprimante…" />
    </>
  );
}

/** Variante contrôlée (ouverte depuis la grille d'adresses). */
export function IpAssignDialog({
  address,
  onClose,
  ...props
}: Omit<IpFieldsProps, "defaultAddress"> & { address: string | null; onClose: () => void }) {
  const toast = useToast();
  return (
    <Dialog open={!!address} onClose={onClose} title={address ? `Attribuer ${address}` : ""}>
      {address && (
        <ActionForm
          key={address}
          action={saveIpAction.bind(null, null)}
          onSuccess={(s) => {
            onClose();
            if (s.message) toast("success", s.message);
          }}
          className="grid gap-5"
        >
          <IpFields {...props} defaultAddress={address} />
          <div className="mt-2 flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              Annuler
            </Button>
            <SubmitButton>Attribuer</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}
