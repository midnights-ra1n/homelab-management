import { api, postForm, write, act } from "../lib/client";
import { navigate } from "../../ui";
import type { AssetStatus } from "../lib/constants";
import type { Asset } from "../lib/data/assets";
import type { FormState } from "../lib/validation";
import { checkIp } from "../lib/net/engine";
import { loadSnapshot } from "../lib/net/snapshot";
import { subnetOf } from "../lib/net/engine";

export async function saveAssetAction(id: number | null, _: FormState, fd: FormData): Promise<FormState> {
  // Live IP check (conflict, outside the subnet…) before saving, as the server action did.
  const ip = String(fd.get("primary_ip") ?? "").trim();
  if (ip) {
    const snap = await loadSnapshot();
    const subnetId = Number(fd.get("primary_subnet_id")) || subnetOf(snap, ip)?.id || null;
    const current = id ? snap.ips.find((i) => i.asset_id === id && i.address === ip)?.id ?? null : null;
    const blocking = checkIp(snap, ip, { subnetId, assetId: id, ipId: current }).find((i) => i.level === "error");
    if (blocking) return { errors: { primary_ip: blocking.message }, message: blocking.message };
  }
  return postForm(id ? `/api/mg/assets/${id}` : "/api/mg/assets", fd);
}

export const bulkAssetAction = (ids: number[], action: unknown) => act("POST", "/api/mg/assets/bulk", { ids, action });

export async function searchAssetsAction(q: string) {
  const query = String(q ?? "").trim().slice(0, 100);
  if (!query) return [];
  const list = await api.get<Asset[]>(`/api/mg/assets?q=${encodeURIComponent(query)}`);
  return list.slice(0, 12).map((a) => ({ id: a.id, kind: a.kind, name: a.display_name, hostname: a.hostname, ip: a.primary_ip, status: a.status }));
}

export async function deleteAssetAction(id: number) {
  await write("DELETE", `/api/mg/assets/${id}`);
  navigate("/inventaire");
}

export async function duplicateAssetAction(id: number) {
  const r = await write<{ redirect?: string }>("POST", `/api/mg/assets/${id}/duplicate`);
  if (r?.redirect) navigate(r.redirect);
}

export const setAssetStatusAction = (id: number, status: AssetStatus) => write("POST", `/api/mg/assets/${id}/status`, { status });

/* Decommissioning */
export const startDecommissionAction = (id: number, reason: string) => act("POST", `/api/mg/assets/${id}/decommission`, { reason });
export const decommissionStepAction = (id: number, key: string, opts: { done?: boolean; run?: boolean }) =>
  act("POST", `/api/mg/assets/${id}/decommission/step`, { key, done: !!opts.done, run: !!opts.run });
export const cancelDecommissionAction = (id: number) => act("POST", `/api/mg/assets/${id}/decommission/cancel`);
export async function finishDecommissionAction(id: number) {
  const r = await act("POST", `/api/mg/assets/${id}/decommission/finish`);
  if (r.ok) navigate("/inventaire");
  return r;
}
export const syncInventoryAction = () => act("POST", "/api/mg/sync");

/** Updates the agents of the given items, or every outdated connected agent (no ids). */
export const updateAgentsAction = (assetIds: number[] = []) => act("POST", "/api/mg/agents/update", { asset_ids: assetIds });
