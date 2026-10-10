"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { dbError, parseForm, success } from "@/lib/action-utils";
import {
  createIp,
  createSubnet,
  createVlan,
  deleteIp,
  deleteSubnet,
  deleteVlan,
  IpConflictError,
  nextFreeIp,
  setPrimaryIp,
  updateIp,
  updateSubnet,
  updateVlan,
} from "@/lib/data/network";
import { ipSchema, subnetSchema, vlanSchema, type FormState } from "@/lib/validation";
import { cidrContains, cidrOverlap, ipToInt, normalizeCidr } from "@/lib/ip";
import { checkIp, diagnose, simulate, type Issue, type SimInput } from "@/lib/net/engine";
import { loadSnapshot } from "@/lib/net/snapshot";
import { createTunnel, deleteTunnel, updateTunnel } from "@/lib/data/vpn";
import { createRule, deleteRule, moveRule, toggleRule, updateRule } from "@/lib/data/firewall";
import { setSetting } from "@/lib/data/settings";
import { ruleSchema, vpnSchema } from "@/lib/validation";

function refresh() {
  revalidatePath("/", "layout");
}

export async function saveVlanAction(id: number | null, _: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseForm(vlanSchema, fd);
  if (!parsed.ok) return parsed.state;
  try {
    if (id) updateVlan(id, parsed.data);
    else createVlan(parsed.data);
  } catch (err) {
    return dbError(err, "vlan_id", "Ce VLAN ID existe déjà");
  }
  refresh();
  return success(id ? "VLAN mis à jour." : "VLAN créé.");
}

export async function deleteVlanAction(id: number) {
  await requireUser();
  deleteVlan(id);
  refresh();
}

export async function saveSubnetAction(id: number | null, _: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseForm(subnetSchema, fd);
  if (!parsed.ok) return parsed.state;
  const s = parsed.data;
  for (const [field, value] of [
    ["gateway", s.gateway],
    ["dhcp_start", s.dhcp_start],
    ["dhcp_end", s.dhcp_end],
  ] as const) {
    if (value && !cidrContains(s.cidr, value)) {
      return { errors: { [field]: `Hors du sous-réseau ${s.cidr}` }, message: "Certains champs sont invalides." };
    }
  }
  if (s.dhcp_start && s.dhcp_end && (ipToInt(s.dhcp_start) ?? 0) > (ipToInt(s.dhcp_end) ?? 0)) {
    return { errors: { dhcp_end: "La fin de plage doit être après le début" }, message: "Plage DHCP inversée." };
  }
  const snap = loadSnapshot();
  const clash = snap.subnets.find((o) => o.id !== id && cidrOverlap(o.cidr, s.cidr));
  if (clash) {
    return { errors: { cidr: `Chevauche ${clash.cidr} (« ${clash.name} »)` }, message: "Ce sous-réseau en recouvre un autre." };
  }
  const vpnClash = snap.tunnels.find((t) => t.tunnel_cidr && cidrOverlap(t.tunnel_cidr, s.cidr));
  if (vpnClash) {
    return { errors: { cidr: `Chevauche le réseau du tunnel « ${vpnClash.name} » (${vpnClash.tunnel_cidr})` }, message: "Conflit avec un tunnel VPN." };
  }
  try {
    if (id) updateSubnet(id, s);
    else createSubnet(s);
  } catch (err) {
    return dbError(err, "cidr", "Ce sous-réseau existe déjà");
  }
  refresh();
  return success(id ? "Sous-réseau mis à jour." : "Sous-réseau créé.");
}

export async function deleteSubnetAction(id: number) {
  await requireUser();
  deleteSubnet(id);
  refresh();
}

export async function saveIpAction(id: number | null, _: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseForm(ipSchema, fd);
  if (!parsed.ok) return parsed.state;
  const blocking = checkIp(loadSnapshot(), parsed.data.address, { subnetId: parsed.data.subnet_id, ipId: id }).find(
    (i) => i.level === "error",
  );
  if (blocking) return { errors: { address: blocking.message }, message: blocking.message };
  try {
    if (id) updateIp(id, parsed.data);
    else createIp(parsed.data);
  } catch (err) {
    if (err instanceof IpConflictError) return { errors: { address: err.message }, message: err.message };
    return dbError(err, "address", "Cette adresse existe déjà");
  }
  refresh();
  return success(id ? "Adresse mise à jour." : "Adresse ajoutée.");
}

export async function deleteIpAction(id: number) {
  await requireUser();
  deleteIp(id);
  refresh();
}

export async function setPrimaryIpAction(id: number) {
  await requireUser();
  setPrimaryIp(id);
  refresh();
}

export async function nextFreeIpAction(subnetId: number): Promise<string | null> {
  await requireUser();
  return nextFreeIp(subnetId);
}

/* Contrôle en direct, diagnostic, simulation ------------------------------- */

export async function checkIpAction(
  address: string,
  ctx: { subnetId?: number | null; assetId?: number | null; ipId?: number | null },
): Promise<Issue[]> {
  await requireUser();
  return checkIp(loadSnapshot(), address, ctx);
}

export async function diagnoseAction(): Promise<Issue[]> {
  await requireUser();
  return diagnose(loadSnapshot());
}

export async function simulateAction(input: SimInput) {
  await requireUser();
  return simulate(loadSnapshot(), input);
}

/* VPN ------------------------------------------------------------------------ */

export async function saveVpnAction(id: number | null, _: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseForm(vpnSchema, fd);
  if (!parsed.ok) return parsed.state;
  const v = parsed.data;
  if (!v.endpoint_b_id && !v.endpoint_b_label) {
    return { errors: { endpoint_b_label: "Choisis un élément ou nomme l'extrémité distante" }, message: "Extrémité B manquante." };
  }
  if (v.tunnel_cidr) {
    for (const [field, ip] of [["ip_a", v.ip_a], ["ip_b", v.ip_b]] as const) {
      if (ip && !cidrContains(v.tunnel_cidr, ip)) return { errors: { [field]: `Hors du réseau du tunnel ${v.tunnel_cidr}` }, message: "IP de tunnel invalide." };
    }
    const clash = loadSnapshot().subnets.find((sn) => cidrOverlap(sn.cidr, v.tunnel_cidr));
    if (clash) return { errors: { tunnel_cidr: `Chevauche ${clash.cidr} (« ${clash.name} »)` }, message: "Le réseau du tunnel recouvre un sous-réseau local." };
  }
  try {
    if (id) updateTunnel(id, v);
    else createTunnel(v);
  } catch (err) {
    return dbError(err);
  }
  refresh();
  return success(id ? "Tunnel mis à jour." : "Tunnel ajouté.");
}

export async function deleteVpnAction(id: number) {
  await requireUser();
  deleteTunnel(id);
  refresh();
}

/* Pare-feu ------------------------------------------------------------------- */

export async function saveRuleAction(id: number | null, _: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseForm(ruleSchema, fd);
  if (!parsed.ok) return parsed.state;
  const r = parsed.data;
  for (const [type, value, field] of [
    [r.src_type, r.src_value, "src_value"],
    [r.dst_type, r.dst_value, "dst_value"],
  ] as const) {
    if (["vlan", "subnet", "asset", "cidr", "vpn"].includes(type) && !value) return { errors: { [field]: "Précise la cible" }, message: "Cible incomplète." };
    if (type === "cidr" && !normalizeCidr(value)) return { errors: { [field]: "CIDR invalide" }, message: "CIDR invalide." };
  }
  if (r.protocol === "icmp") r.ports = "";
  try {
    if (id) updateRule(id, r);
    else createRule(r);
  } catch (err) {
    return dbError(err);
  }
  refresh();
  return success(id ? "Règle mise à jour." : "Règle ajoutée.");
}

export async function deleteRuleAction(id: number) {
  await requireUser();
  deleteRule(id);
  refresh();
}

export async function toggleRuleAction(id: number) {
  await requireUser();
  toggleRule(id);
  refresh();
}

export async function moveRuleAction(id: number, direction: -1 | 1) {
  await requireUser();
  moveRule(id, direction);
  refresh();
}

export async function setDefaultPolicyAction(policy: "allow" | "deny") {
  await requireUser();
  setSetting("fw_default_policy", policy === "deny" ? "deny" : "allow");
  refresh();
}
