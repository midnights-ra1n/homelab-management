import { api, postForm, write } from "../lib/client";
import type { FormState } from "../lib/validation";
import { checkIp, diagnose, simulate, type SimInput } from "../lib/net/engine";
import { loadSnapshot } from "../lib/net/snapshot";

const save = (base: string) => (id: number | null, _: FormState, fd: FormData) => postForm(id ? `${base}/${id}` : base, fd);
const del = (base: string) => (id: number) => write("DELETE", `${base}/${id}`);

export const saveVlanAction = save("/api/mg/vlans");
export const deleteVlanAction = del("/api/mg/vlans");
export const saveSubnetAction = save("/api/mg/subnets");
export const deleteSubnetAction = del("/api/mg/subnets");
export const deleteIpAction = del("/api/mg/ips");
export const setPrimaryIpAction = (id: number) => write("POST", `/api/mg/ips/${id}/primary`);
export const saveVpnAction = save("/api/mg/vpn");
export const deleteVpnAction = del("/api/mg/vpn");
export const saveRuleAction = save("/api/mg/firewall");
export const deleteRuleAction = del("/api/mg/firewall");
export const toggleRuleAction = (id: number) => write("POST", `/api/mg/firewall/${id}/toggle`);
export const moveRuleAction = (id: number, direction: -1 | 1) => write("POST", `/api/mg/firewall/${id}/move`, { direction });
export const setDefaultPolicyAction = (policy: "allow" | "deny") => write("PUT", "/api/mg/firewall-policy", { policy });
export const saveDomainAction = save("/api/mg/domains");
export const deleteDomainAction = del("/api/mg/domains");

export async function saveIpAction(id: number | null, _: FormState, fd: FormData): Promise<FormState> {
  const address = String(fd.get("address") ?? "").trim();
  const blocking = checkIp(await loadSnapshot(), address, { subnetId: Number(fd.get("subnet_id")) || null, ipId: id }).find((i) => i.level === "error");
  if (blocking) return { errors: { address: blocking.message }, message: blocking.message };
  return postForm(id ? `/api/mg/ips/${id}` : "/api/mg/ips", fd);
}

export async function nextFreeIpAction(subnetId: number): Promise<string | null> {
  return (await api.get<{ ip: string | null }>(`/api/mg/subnets/${subnetId}/next-free`)).ip;
}

/* The network engine runs in the browser on the IPAM snapshot. */
export const checkIpAction = async (address: string, ctx: { subnetId?: number | null; assetId?: number | null; ipId?: number | null }) =>
  checkIp(await loadSnapshot(), address, ctx);
export const diagnoseAction = async () => diagnose(await loadSnapshot());
export const simulateAction = async (input: SimInput) => simulate(await loadSnapshot(), input);
